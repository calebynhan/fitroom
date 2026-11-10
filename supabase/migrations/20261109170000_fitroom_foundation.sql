-- FitRoom foundation: looks history, per-user daily look limit and a shared daily photo budget.
-- Clients (signed in with Supabase Auth) may only READ and DELETE their own looks, shots and shot files.
-- Everything that costs money goes through the fr_* functions, which only the server (secret key) can call.

-- ---------------------------------------------------------------- tables

create table public.looks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  day date not null default ((now() at time zone 'utc')::date),
  status text not null default 'developing' check (status in ('developing', 'ready', 'failed')),
  scene text not null check (scene in ('studio', 'city', 'night')),
  items jsonb not null default '[]'::jsonb,
  body jsonb not null default '{}'::jsonb
);
create index looks_user_recent on public.looks (user_id, created_at desc);
create index looks_user_day on public.looks (user_id, day);

create table public.shots (
  look_id uuid not null references public.looks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  view text not null check (view in ('front', 'three_quarter', 'side', 'back')),
  status text not null default 'developing' check (status in ('developing', 'done', 'failed')),
  attempts int not null default 0,
  billed int not null default 0,
  storage_path text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (look_id, view)
);
create index shots_user on public.shots (user_id);

-- Photos reserved per UTC day across all users: the hard daily spend cap.
create table public.photo_budget (
  day date primary key,
  photos int not null default 0 check (photos >= 0)
);

-- ---------------------------------------------------------------- row level security

alter table public.looks enable row level security;
alter table public.shots enable row level security;
alter table public.photo_budget enable row level security;

create policy "own looks: read" on public.looks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own looks: delete" on public.looks
  for delete to authenticated using ((select auth.uid()) = user_id);
create policy "own shots: read" on public.shots
  for select to authenticated using ((select auth.uid()) = user_id);
-- photo_budget has no policies: server only.

revoke all on public.looks, public.shots, public.photo_budget from anon;
revoke insert, update on public.looks, public.shots from authenticated;
revoke all on public.photo_budget from authenticated;

-- ---------------------------------------------------------------- storage: private bucket, files under <user id>/

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shots', 'shots', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy "own shot files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own shot files: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- server functions

-- Starts a look for a user: refuses past the user's daily look limit or the shared daily photo cap, reserves
-- p_photos photos (one per angle) and opens the front shot. Serialised per user so parallel requests can't
-- both slip under the limit.
create or replace function public.fr_start_look(
  p_user uuid, p_scene text, p_items jsonb, p_body jsonb,
  p_look_limit int, p_daily_photo_cap int, p_photos int default 4
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_used int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('fr_look:' || p_user::text, 0));
  select count(*) into v_used from public.looks
    where user_id = p_user and day = v_day and status <> 'failed';
  if v_used >= p_look_limit then
    return jsonb_build_object('ok', false, 'reason', 'user_limit', 'looks_left', 0);
  end if;
  insert into public.photo_budget (day, photos) values (v_day, 0) on conflict (day) do nothing;
  update public.photo_budget set photos = photos + p_photos
    where day = v_day and photos + p_photos <= p_daily_photo_cap;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap', 'looks_left', greatest(p_look_limit - v_used, 0));
  end if;
  insert into public.looks (user_id, day, scene, items, body)
    values (p_user, v_day, p_scene, p_items, p_body) returning id into v_id;
  insert into public.shots (look_id, user_id, view, status, attempts)
    values (v_id, p_user, 'front', 'developing', 1);
  return jsonb_build_object('ok', true, 'look_id', v_id, 'looks_left', p_look_limit - v_used - 1);
end $$;

-- Claims one of the other angles of a ready look for a request. Refuses a finished angle, a duplicate while one
-- is developing (unless it has been stuck for 3 minutes), and more than p_max_attempts attempts. A retry after
-- a billed failure reserves one more photo against the daily cap.
create or replace function public.fr_claim_shot(
  p_user uuid, p_look uuid, p_view text, p_daily_photo_cap int, p_max_attempts int default 3
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_look public.looks%rowtype;
  v_shot public.shots%rowtype;
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_view not in ('three_quarter', 'side', 'back') then
    return jsonb_build_object('ok', false, 'reason', 'bad_view');
  end if;
  select * into v_look from public.looks where id = p_look and user_id = p_user for update;
  if not found or v_look.status <> 'ready' then
    return jsonb_build_object('ok', false, 'reason', 'no_look');
  end if;
  select * into v_shot from public.shots where look_id = p_look and view = p_view for update;
  if found then
    if v_shot.status = 'done' then
      return jsonb_build_object('ok', false, 'reason', 'done');
    end if;
    if v_shot.status = 'developing' and v_shot.started_at > now() - interval '3 minutes' then
      return jsonb_build_object('ok', false, 'reason', 'busy');
    end if;
    if v_shot.attempts >= p_max_attempts then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    if v_shot.billed > 0 then
      insert into public.photo_budget (day, photos) values (v_day, 0) on conflict (day) do nothing;
      update public.photo_budget set photos = photos + 1
        where day = v_day and photos + 1 <= p_daily_photo_cap;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'daily_cap');
      end if;
    end if;
    update public.shots
      set status = 'developing', attempts = attempts + 1, started_at = now(), finished_at = null
      where look_id = p_look and view = p_view;
  else
    insert into public.shots (look_id, user_id, view, status, attempts)
      values (p_look, p_user, p_view, 'developing', 1);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Records how an attempt ended: 'done' (photo made, saved at p_path), 'billed' (failed, may have cost money) or
-- 'free' (failed at no cost). A failed front fails the look: it is not charged to the user and its reserved
-- photos go back to the budget (all 4, or 3 if the failed front itself was billed).
create or replace function public.fr_finish_shot(
  p_look uuid, p_view text, p_outcome text, p_path text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_day date;
begin
  if p_outcome not in ('done', 'billed', 'free') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  update public.shots set
      status = case when p_outcome = 'done' then 'done' else 'failed' end,
      billed = billed + case when p_outcome = 'free' then 0 else 1 end,
      storage_path = coalesce(p_path, storage_path),
      finished_at = now()
    where look_id = p_look and view = p_view;
  if p_view = 'front' then
    if p_outcome = 'done' then
      update public.looks set status = 'ready' where id = p_look;
    else
      update public.looks set status = 'failed' where id = p_look returning day into v_day;
      update public.photo_budget
        set photos = greatest(photos - case when p_outcome = 'billed' then 3 else 4 end, 0)
        where day = v_day;
    end if;
  end if;
end $$;

-- Only the server may call these (they bypass RLS and spend the budget).
revoke all on function public.fr_start_look(uuid, text, jsonb, jsonb, int, int, int) from public, anon, authenticated;
revoke all on function public.fr_claim_shot(uuid, uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.fr_finish_shot(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fr_start_look(uuid, text, jsonb, jsonb, int, int, int) to service_role;
grant execute on function public.fr_claim_shot(uuid, uuid, text, int, int) to service_role;
grant execute on function public.fr_finish_shot(uuid, text, text, text) to service_role;
