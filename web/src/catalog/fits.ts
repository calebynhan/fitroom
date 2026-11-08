// web/public/garments/fits.json (from Session A): per-item fit morph weights, plus name rules for pasted links.

export type FitMorphs = Record<string, number>;

export interface FitsFile {
  items: Record<string, { shape?: string; morphs: FitMorphs; fit?: string }>;
  name_rules: { match: string; morphs: FitMorphs }[];
}

export interface ItemFit {
  morphs: FitMorphs;
  label: string | null;
}

const NO_FIT: ItemFit = { morphs: {}, label: null };

function isMorphs(v: unknown): v is FitMorphs {
  return !!v && typeof v === 'object' && Object.values(v).every((n) => typeof n === 'number');
}

export function parseFits(data: unknown): FitsFile | null {
  const d = data as Partial<FitsFile> | null;
  if (!d || typeof d.items !== 'object' || !d.items) return null;
  const items = Object.fromEntries(Object.entries(d.items).filter(([, v]) => isMorphs(v?.morphs)));
  const rules = Array.isArray(d.name_rules) ? d.name_rules.filter((r) => typeof r?.match === 'string' && isMorphs(r.morphs)) : [];
  return { items, name_rules: rules };
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/** Exact item entry first, then the first name rule that matches the product name. */
export function fitFor(fits: FitsFile | null, id: string, name: string): ItemFit {
  if (!fits) return NO_FIT;
  const exact = fits.items[id];
  if (exact) return { morphs: exact.morphs, label: exact.fit ?? null };
  const rule = fits.name_rules.find((r) => safeRegex(r.match)?.test(name));
  return rule ? { morphs: rule.morphs, label: null } : NO_FIT;
}
