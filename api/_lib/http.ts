export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * True for a JSON request from this site's own pages. Blocks cross-site form posts (a text/plain body that parses as
 * JSON would otherwise carry the shopper's SameSite=Lax cookie on a top-level navigation) and cross-site fetches.
 */
export function fromThisSite(request: Request): boolean {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('application/json')) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

/** Parses a JSON object body; returns null for anything else. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
