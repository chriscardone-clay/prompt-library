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
    .filter((x): x is { name?: unknown; content?: unknown } => !!x && typeof x === "object")
    .map((x) => ({ name: String(x.name ?? ""), content: String(x.content ?? "") }))
    .filter((f) => f.name.trim());
}

export function asLinks(v: unknown): SkillLink[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { label?: unknown; url?: unknown } => !!x && typeof x === "object")
    .map((x) => ({ label: String(x.label ?? ""), url: String(x.url ?? "") }))
    .filter((l) => l.url.trim());
}
