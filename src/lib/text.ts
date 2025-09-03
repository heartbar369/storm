export const SPLIT_RE = /\r\n|\n|\r|\u2028|\u2029/;

export function computedTitleFromBody(body: string): string {
  const lines = body.split(SPLIT_RE);
  const first = (lines.find((l) => l.trim().length > 0) || '').trim();
  return first.slice(0, 120);
}

export function bodyWithoutTitle(body: string): string {
  const lines = body.split(SPLIT_RE);
  let used = false;
  const rest: string[] = [];
  for (const l of lines) {
    if (!used && l.trim().length > 0) { used = true; continue; }
    rest.push(l);
  }
  return rest.join('\n').trim();
}
