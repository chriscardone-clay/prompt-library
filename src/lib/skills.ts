import type { SkillFile, SkillLink } from "./types";

/** "https://www.notion.so/x" → "notion.so"; falls back to the raw string. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isSkillMd(name: string): boolean {
  return /^skill\.md$/i.test(name.trim());
}

/** The SKILL.md content, or the first file's content, or "". */
export function skillMd(files: SkillFile[]): string {
  const f = files.find((x) => isSkillMd(x.name)) ?? files[0];
  return f ? f.content : "";
}

/** name / description from a SKILL.md YAML-ish frontmatter block. */
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = /^\s*---\s*\n([\s\S]*?)\n---/.exec(md);
  const block = m ? m[1] : md;
  const name = /^\s*name:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const description = /^\s*description:\s*(.+)$/m.exec(block)?.[1]?.trim();
  return { name: name || undefined, description: description || undefined };
}

/** "clay-formulas" → "Clay formulas" */
export function titleFromSlug(slug: string): string {
  return slug.trim().replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Folder / archive name for a skill: frontmatter name, else the title, slugified. */
export function skillSlug(title: string, files: SkillFile[]): string {
  const raw = parseFrontmatter(skillMd(files)).name || title;
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill"
  );
}

export function isArchiveName(name: string): boolean {
  return /\.(skill|zip)$/i.test(name);
}

/** Runtime shape check for JSON coming back from the database. */
export function asFiles(v: unknown): SkillFile[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is { name?: unknown; content?: unknown; path?: unknown; size?: unknown; type?: unknown } =>
        !!x && typeof x === "object",
    )
    .map((x) => {
      const f: SkillFile = { name: String(x.name ?? ""), content: String(x.content ?? "") };
      if (typeof x.path === "string" && x.path) {
        f.path = x.path;
        f.size = typeof x.size === "number" ? x.size : 0;
        if (typeof x.type === "string" && x.type) f.type = x.type;
        f.content = "";
      }
      return f;
    })
    .filter((f) => f.name.trim());
}

/** Bytes a file contributes to the bundle size. */
export function fileBytes(f: SkillFile): number {
  if (f.path) return f.size ?? 0;
  // UTF-8 length without allocating an encoder for every keystroke.
  let n = 0;
  for (let i = 0; i < f.content.length; i++) {
    const c = f.content.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3;
  }
  return n;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024).toLocaleString()} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function asLinks(v: unknown): SkillLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { label?: unknown; url?: unknown } => !!x && typeof x === "object")
    .map((x) => ({ label: String(x.label ?? ""), url: String(x.url ?? "") }))
    .filter((l) => l.url.trim());
}
