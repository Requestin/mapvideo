// Tiny cookie reader — we only ever need csrf_token, so a full parser is
// overkill. Returns undefined when the cookie is missing so callers can
// decide what to do (usually: hit GET /api/auth/csrf to seed it).
export function readCookie(name: string): string | undefined {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  if (!match) return undefined;
  const raw = match.slice(name.length + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
