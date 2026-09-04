/**
 * Placeholders are written as {{company}} / {{first_name}} / {{Deal size}}.
 * The same regex is used to extract keys, to fill a body, and to split a
 * body into renderable segments.
 */
export const PLACEHOLDER_RE = /\{\{\s*([\w .\-]+?)\s*\}\}/g;

export function parsePlaceholders(body: string): string[] {
  const out: string[] = [];
  for (const m of (body || "").matchAll(PLACEHOLDER_RE)) {
    const k = m[1].trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export function fillBody(body: string, fills: Record<string, string>): string {
  return (body || "").replace(PLACEHOLDER_RE, (_, k: string) => {
    const key = k.trim();
    const v = fills[key];
    return v && v.trim() ? v : `{{${key}}}`;
  });
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "placeholder"; key: string; value: string };

export function segmentBody(body: string, fills: Record<string, string>): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of (body || "").matchAll(PLACEHOLDER_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ kind: "text", text: body.slice(last, idx) });
    const key = m[1].trim();
    segments.push({ kind: "placeholder", key, value: fills[key] ?? "" });
    last = idx + m[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return segments;
}

export function wordCount(body: string): number {
  return (body || "").split(/\s+/).filter(Boolean).length;
}
