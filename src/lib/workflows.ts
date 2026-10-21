/**
 * Workflows: reference architectures saved as one Markdown file. Pure helpers
 * shared by the editor (browser), the Server Actions and the detail page.
 *
 * The .md is files[0] and is never rewritten: no line-ending, whitespace or
 * BOM changes, so what was uploaded is exactly what downloads.
 */
import { SUGGESTED_INTEGRATIONS, type WorkflowTrigger } from "./constants";
import { tidyDescription } from "./skills";
import type { Prompt, SkillFile } from "./types";

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name.trim());
}

/** The architecture .md of a workflow (files[0]). */
export function workflowDoc(files: SkillFile[]): SkillFile | undefined {
  const f = files[0];
  return f && !f.path ? f : undefined;
}

/** Files that travel with a workflow's .md (stored in Storage). */
export function workflowAttachments(files: SkillFile[]): SkillFile[] {
  return files.slice(1).filter((f) => !!f.path);
}

/** A reference architecture has no parent; an adaptation is any fork. */
export function isAdaptation(p: Pick<Prompt, "parentId">): boolean {
  return !!p.parentId;
}

/**
 * Decode an uploaded file without changing it: keep a leading BOM, and refuse
 * anything that isn't valid UTF-8 rather than silently replacing characters.
 */
export function decodeExact(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The .md travels to the editor base64-encoded. React's server-component
 * payload drops a BOM at the start of a long string, which would silently
 * change the file on the next save; base64 carries every byte.
 */
const PACKED = "base64:";

export function packDoc(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return PACKED + btoa(bin);
}

export function unpackDoc(packed: string): string {
  if (!packed.startsWith(PACKED)) return packed;
  const bin = atob(packed.slice(PACKED.length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodeExact(bytes) ?? new TextDecoder().decode(bytes);
}

/** A workflow's files with the .md packed for the trip to the editor. */
export function packDocFiles(files: SkillFile[]): SkillFile[] {
  return files.map((f, i) => (i === 0 ? { ...f, content: packDoc(f.content) } : { ...f }));
}

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(md: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  let fence: string | null = null;
  md.split(/\r\n|\r|\n/).forEach((text, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return;
    }
    if (!fence) out.push({ n: i + 1, text });
  });
  return out;
}

/** Plain text of a line of inline Markdown: links, emphasis and code marks removed. */
function plain(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Title (first # heading) and description (first paragraph after it) of a doc. */
export function docFacts(md: string): { title?: string; description?: string } {
  const lines = proseLines(md.replace(/^﻿/, ""));
  const h1 = lines.findIndex((l) => /^\s{0,3}#\s+\S/.test(l.text));
  const title = h1 >= 0 ? plain(lines[h1].text.replace(/^\s{0,3}#\s+/, "").replace(/\s+#+\s*$/, "")) : undefined;
  const para: string[] = [];
  for (let i = h1 + 1; i < lines.length; i++) {
    const t = lines[i].text.trim();
    if (!t) {
      if (para.length) break;
      continue;
    }
    // Skip structure before the first real paragraph.
    if (/^(#|\||>|[-*+]\s|\d+\.\s|<|---|===)/.test(t)) {
      if (para.length) break;
      continue;
    }
    para.push(t);
  }
  const description = para.length ? tidyDescription(plain(para.join(" ")), 300) : undefined;
  return { title: title && title.length <= 200 ? title : title?.slice(0, 200), description };
}

/** Integrations named in a doc, from the catalog (or the starter list), in list order. */
export function suggestIntegrations(md: string, names: readonly string[] = SUGGESTED_INTEGRATIONS): string[] {
  return names.filter((name) =>
    new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i").test(md),
  );
}

/** A best guess at the trigger from the top of the doc; "" when unclear. */
export function suggestTrigger(md: string): WorkflowTrigger | "" {
  const head = md.slice(0, 4000);
  if (/\bwebhook\b/i.test(head)) return "webhook";
  if (/\b(cron|schedul(e|ed)|daily|weekly|nightly)\b/i.test(head)) return "schedule";
  if (/\b(new|added) (table )?rows?\b|\btable row\b/i.test(head)) return "table";
  return "";
}

// ── Customer-ready scan ─────────────────────────────────────────────
export interface Finding {
  line: number;
  rule: "clay-email" | "email" | "record-id" | "crm-host" | "slack-id" | "internal-url" | "credential";
  message: string;
  excerpt: string;
}

const PLACEHOLDER_EMAIL = /@(example\.(com|org|net)|acme\.(com|io)|company\.com|your-?(org|company|domain)\.\w+)$/i;

const RULES: { rule: Finding["rule"]; re: RegExp; message: string; keep?: (m: string) => boolean }[] = [
  { rule: "clay-email", re: /[A-Z0-9._%+-]+@clay\.(com|run)\b/gi, message: "Internal @clay.com email address." },
  {
    rule: "email",
    re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    message: "Looks like a real email address.",
    keep: (m) => !/@clay\.(com|run)$/i.test(m) && !PLACEHOLDER_EMAIL.test(m),
  },
  {
    rule: "record-id",
    re: /\b00[0-9A-Za-z][0-9A-Za-z]{12}(?:[0-9A-Za-z]{3})?\b/g,
    message: "Looks like a Salesforce record ID.",
    // Real ids mix digits with letters after the prefix; plain words and numbers don't.
    keep: (m) => /\d/.test(m.slice(3)) && /[A-Za-z]/.test(m.slice(3)),
  },
  {
    rule: "crm-host",
    re: /\b[a-z0-9][a-z0-9-]*\.(lightning\.force\.com|my\.salesforce\.com|my\.site\.com)\b/gi,
    message: "Real CRM hostname. Use a placeholder like <your-org>.",
  },
  { rule: "slack-id", re: /\b[CDGU]0[A-Z0-9]{7,11}\b/g, message: "Looks like a Slack channel or user ID." },
  {
    rule: "internal-url",
    re: /\bhttps?:\/\/[^\s)>\]]*(slack\.com\/archives|notion\.so|clay-hq\.slack\.com|app\.clay\.com\/workspaces)[^\s)>\]]*/gi,
    message: "Internal link (Slack, Notion or a Clay workspace).",
  },
  {
    rule: "credential",
    re: /\b(xox[abposr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/g,
    message: "Looks like a credential or token.",
  },
];

/**
 * Things in a doc that shouldn't leave Clay. Warnings, not blocks: the owner
 * decides. Scans every line, code blocks included (that's where ids hide).
 */
export function scanForInternal(md: string, limit = 50): Finding[] {
  const out: Finding[] = [];
  md.split(/\r\n|\r|\n/).forEach((text, i) => {
    if (out.length >= limit) return;
    const seen = new Set<string>();
    for (const r of RULES) {
      for (const m of text.matchAll(r.re)) {
        const hit = m[0];
        if (r.keep && !r.keep(hit)) continue;
        if (seen.has(hit)) continue;
        seen.add(hit);
        const at = m.index ?? 0;
        const excerpt = text.slice(Math.max(0, at - 30), at + hit.length + 30).trim();
        out.push({ line: i + 1, rule: r.rule, message: r.message, excerpt });
        if (out.length >= limit) return;
      }
    }
  });
  return out;
}

/** "inbound-lead-routing.md" for a title, when a doc is written in the editor. */
export function docFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/—.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "workflow"}.md`;
}
