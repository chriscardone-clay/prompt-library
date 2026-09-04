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

/**
 * Read one top-level scalar from a YAML frontmatter block. Handles plain,
 * "double-quoted" (with \" \\ \n escapes), 'single-quoted' ('' → ') and
 * block (`>` folded / `|` literal) strings. Not a YAML parser; enough for
 * SKILL.md's `name:` and `description:`.
 */
function yamlScalar(block: string, key: string): string | undefined {
  const lines = block.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start < 0) return undefined;
  let rest = lines[start].replace(new RegExp(`^${key}\\s*:\\s*`), "");
  // Strip a trailing comment on plain scalars (" # …"), never inside quotes.
  const blockIndicator = /^([>|])([+-]?)\s*(#.*)?$/.exec(rest);
  if (blockIndicator) {
    const folded = blockIndicator[1] === ">";
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === "") {
        body.push("");
        continue;
      }
      if (!/^\s/.test(l)) break; // back to top level
      body.push(l.replace(/^\s+/, ""));
    }
    const text = folded
      ? body.join("\n").replace(/([^\n])\n(?!\n)/g, "$1 ").replace(/\n{2,}/g, "\n")
      : body.join("\n");
    return text.trim();
  }
  if (rest.startsWith('"')) {
    // Double-quoted; may continue on following lines until the closing quote.
    let i = start;
    let buf = rest;
    while (!/(^|[^\\])(\\\\)*"\s*(#.*)?$/.test(buf) && i + 1 < lines.length) {
      i++;
      buf += " " + lines[i].trim();
    }
    const inner = buf.replace(/^"/, "").replace(/"\s*(#.*)?$/, "");
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  }
  if (rest.startsWith("'")) {
    let i = start;
    let buf = rest;
    while (!/(^|[^'])'(?:'')*\s*(#.*)?$/.test(buf.slice(1)) && i + 1 < lines.length) {
      i++;
      buf += " " + lines[i].trim();
    }
    const inner = buf.replace(/^'/, "").replace(/'\s*(#.*)?$/, "");
    return inner.replace(/''/g, "'").trim();
  }
  // Plain scalar, possibly continued on indented lines.
  let i = start;
  while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s+\S+\s*:/.test(lines[i + 1])) {
    i++;
    rest += " " + lines[i].trim();
  }
  rest = rest.replace(/\s+#.*$/, "");
  return rest.trim() || undefined;
}

/** Collapse whitespace and keep a description within the app's 600-char limit, ending on a sentence. */
export function tidyDescription(text: string, max = 600): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "").trimEnd() + "…";
}

/**
 * name / description from a SKILL.md YAML frontmatter block, plus the first
 * "# Heading" of the body, which usually reads better as a title than the
 * slug-style `name`.
 */
export function parseFrontmatter(md: string): { name?: string; description?: string; heading?: string } {
  const src = md.replace(/\r\n/g, "\n");
  const m = /^\s*---\s*\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(src);
  const block = m ? m[1] : src;
  const body = m ? src.slice(m.index + m[0].length) : src;
  const name = yamlScalar(block, "name")?.replace(/\s+/g, " ");
  const description = yamlScalar(block, "description");
  const heading = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1]?.replace(/\s+/g, " ").trim();
  return {
    name: name || undefined,
    description: description ? tidyDescription(description) : undefined,
    heading: heading && heading.length <= 200 ? heading : undefined,
  };
}

/** Best display title for a skill from its SKILL.md: heading, else the frontmatter name, else none. */
export function skillTitleFrom(md: string): string | undefined {
  const fm = parseFrontmatter(md);
  return fm.heading || (fm.name ? titleFromSlug(fm.name) : undefined);
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
