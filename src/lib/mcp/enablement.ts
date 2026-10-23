import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { z } from "zod";
import { approvalLine, compactDiff, compareOutdated, DEFAULT_DUE_DAYS, diffLines, DUE_SOON_DAYS, REASON_LABELS, RUBRIC, STATUS_LABELS, type ReviewReason, type ReviewStatus } from "@/lib/approval";
import { type Decision, notifyDecision, notifyRequest } from "@/lib/enablementNotify";
import { notifyFeedbackPosted } from "@/lib/feedbackNotify";
import { parsePlaceholders } from "@/lib/placeholders";
import type { Prompt } from "@/lib/types";
import { qualityNotes } from "./create";
import { applyFilters, findItem, isMine, itemUrl, type Library, popularity, search, summarize } from "./library";
import type { McpUser } from "./oauth";
import type { Traced } from "./track";

/**
 * Enablement through the connector: top items, the review queue, audits,
 * decisions, gold standards, use cases and outdated flags. Decisions run as
 * the connected person through connector_enablement (migration 0027), so the
 * same SQL rules apply as on /enablement. Reviewer-only tools are only
 * registered for reviewers.
 */

export interface EnablementContext {
  service: SupabaseClient;
  me: McpUser;
  library: () => Promise<Library>;
  traced: Traced;
  /** The person has ENABLEMENT_APPROVED. */
  enablement: boolean;
  /** On the enablement_reviewers list (and has the flag). */
  reviewer: boolean;
  canWrite: boolean;
  reconnect: () => { content: { type: "text"; text: string }[]; isError: true };
}

/** Is this person on the Enablement reviewers list? (can_review(), checked as the service role.) */
export async function isReviewerEmail(service: SupabaseClient, email: string): Promise<boolean> {
  const { data } = await service.from("enablement_reviewers").select("email").eq("email", email.trim().toLowerCase()).maybeSingle();
  return !!data;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}
function fail(t: string) {
  return { ...text(t), isError: true as const };
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

interface UseCaseRow {
  id: string;
  name: string;
  description: string;
  gold_prompt_id: string | null;
  archived: boolean;
}

async function loadUseCases(service: SupabaseClient): Promise<UseCaseRow[]> {
  const { data } = await service.from("enablement_use_cases").select("id, name, description, gold_prompt_id, archived").order("position").order("name");
  return (data ?? []) as UseCaseRow[];
}

/** A use case by id or name (case-insensitive), active ones only. */
function findUseCase(all: UseCaseRow[], key: string | undefined): UseCaseRow | undefined {
  const k = (key ?? "").trim().toLowerCase();
  if (!k) return undefined;
  return all.find((u) => !u.archived && (u.id === k || u.name.toLowerCase() === k));
}

const useCaseList = (all: UseCaseRow[]) => all.filter((u) => !u.archived).map((u) => u.name).join(", ") || "none yet (create_use_case adds one)";

interface ReviewRow {
  id: string;
  prompt_id: string;
  reason: ReviewReason;
  status: ReviewStatus;
  tier: "approved" | "gold" | null;
  use_case_id: string | null;
  request_note: string;
  decision_note: string;
  rubric: Record<string, boolean> | null;
  body_snapshot: string | null;
  decided_at: string | null;
  created_at: string;
  requester: { name: string; email: string } | null;
  reviewer: { name: string } | null;
}

const REVIEW_SELECT = `id, prompt_id, reason, status, tier, use_case_id, request_note, decision_note, rubric, body_snapshot, decided_at, created_at,
  requester:profiles!prompt_reviews_requested_by_fkey ( name, email ),
  reviewer:profiles!prompt_reviews_reviewer_id_fkey ( name )`;

/** Run one Enablement action as the connected person. SQL raises friendly messages; pass them on. */
async function act(ctx: EnablementContext, action: string, args: Record<string, unknown>): Promise<{ ok: true; id: string | null; joined?: boolean } | { ok: false; error: string }> {
  const { data, error } = await ctx.service.rpc("connector_enablement", { p_actor: ctx.me.id, p_action: action, p_args: args });
  if (error) return { ok: false, error: error.message || "Something went wrong." };
  const d = (data ?? {}) as { id?: string | null; joined?: boolean };
  return { ok: true, id: d.id ?? null, joined: d.joined };
}

/** The rubric as tool input: every key optional, true when it passes. */
const rubricShape = z
  .object(Object.fromEntries(RUBRIC.map((r) => [r.key, z.boolean().optional().describe(`${r.label}: ${r.hint}`)])) as Record<(typeof RUBRIC)[number]["key"], z.ZodOptional<z.ZodBoolean>>)
  .optional()
  .describe("Which rubric checks passed. Fill this from the audit and what the person confirmed.");
const rubricOf = (r: Partial<Record<string, boolean>> | undefined) => Object.fromEntries(RUBRIC.map((x) => [x.key, !!r?.[x.key]]));

const idArg = z.string().min(1).describe("Item id (or its clayprompts.com link)");
const notFound = (id: string) => fail(`No item with id ${id} that you can see. Search again with search_library.`);

// ── Audit helpers ───────────────────────────────────────────────────
const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RECORD_LINK = /https?:\/\/[^\s)]*(salesforce\.com|lightning\.force\.com|gong\.io\/call|hubspot\.com\/contacts|docs\.google\.com|notion\.so)[^\s)]*/gi;

function contentOf(p: Prompt): string {
  return p.kind === "prompt" ? p.body : p.files.filter((f) => !f.path).map((f) => f.content).join("\n\n") || p.body;
}

interface Check {
  key: string;
  label: string;
  signal: "pass" | "warn" | "check";
  evidence: string[];
}

function autoChecks(l: Library, p: Prompt, similar: Prompt[], gold: Prompt | undefined, openFeedback: number): Check[] {
  const body = contentOf(p);
  const draft = { kind: p.kind, title: p.title, description: p.description, body: p.body, notes: p.notes, files: p.files, links: p.links, apps: p.apps, audiences: p.audiences, visibility: p.visibility, forkNote: p.forkNote, editors: [] };
  const quality = qualityNotes(draft);
  const keys = p.kind === "prompt" ? parsePlaceholders(p.body) : [];
  const ageDays = Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / 86_400_000);
  const emails = [...new Set((body.match(EMAIL) ?? []).filter((e) => !/@(clay\.com|example\.com)$/i.test(e)))];
  const links = [...new Set(body.match(RECORD_LINK) ?? [])];
  const secret = SECRET.exec(body)?.[0];

  const clear: string[] = [...quality];
  if (!p.notes.trim()) clear.push("No How to use notes.");
  if (p.description && p.description.length < 40) clear.push(`Description is short (${p.description.length} characters).`);
  const cryptic = keys.filter((k) => k.length < 3);
  if (cryptic.length) clear.push(`Cryptic fill-ins: ${cryptic.map((k) => `{{${k}}}`).join(", ")}.`);

  const current: string[] = [];
  if (p.approval.outdated) current.push(`Flagged outdated ${day(p.approval.outdated.at)}: ${p.approval.outdated.note}`);
  if (ageDays > 180) current.push(`Last updated ${ageDays} days ago.`);
  const years = [...new Set(body.match(/\b20(1\d|2[0-4])\b/g) ?? [])];
  if (years.length) current.push(`Mentions ${years.join(", ")}; check those references still hold.`);

  const safe: string[] = [];
  if (secret) safe.push(`Looks like a credential or token: ${secret.slice(0, 8)}…`);
  if (emails.length) safe.push(`Email addresses outside Clay: ${emails.slice(0, 5).join(", ")}.`);
  if (links.length) safe.push(`Links to records or internal docs: ${links.slice(0, 3).join(", ")}${links.length > 3 ? ` and ${links.length - 3} more` : ""}.`);

  const unique: string[] = [];
  if (gold && gold.id !== p.id) unique.push(`Gold standard for this use case: "${gold.title}" (${gold.id}). Compare against it.`);
  if (similar.length) unique.push(`Similar items: ${similar.slice(0, 4).map((s) => `"${s.title}" (${s.id})`).join(", ")}.`);

  const works: string[] = [];
  if (!body.trim()) works.push("No content here; it lives at its links. Open it there to test.");
  if (openFeedback) works.push(`${plural(openFeedback, "open feedback comment")} on its page.`);

  return [
    { key: "works", label: "Works as described", signal: works.length ? "warn" : "check", evidence: works.length ? works : ["Can't be checked automatically: run it on a real case (run_prompt) before approving."] },
    { key: "clear", label: "Clear to a new hire", signal: clear.length ? "warn" : "pass", evidence: clear.length ? clear : ["Has a description, How to use notes and readable fill-ins."] },
    { key: "current", label: "Current", signal: current.length ? "warn" : "check", evidence: current.length ? current : [`Updated ${ageDays} days ago. Check product names, pricing and messaging against today's.`] },
    { key: "safe", label: "Safe", signal: safe.length ? "warn" : "pass", evidence: safe.length ? safe : ["No credentials, outside emails or record links found."] },
    { key: "unique", label: "Not a duplicate", signal: unique.length ? "check" : "pass", evidence: unique.length ? unique : ["Nothing similar in the library."] },
  ];
}

// ── Impact scan helpers ─────────────────────────────────────────────
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Case-insensitive, from the start of a word: "Claygent" finds "Claygents" and
 * "Claygent's" but not "MyClaygent"; "$0.10" matches as typed. Errs towards
 * extra hits, since a missed item is worse than one to skip.
 */
function termRe(term: string): RegExp {
  const t = term.trim();
  return new RegExp(`${/^\w/.test(t) ? "\\b" : ""}${escapeRe(t)}`, "gi");
}

interface Hit {
  term: string;
  where: string;
  snippet: string;
}

/** Every field a person reads: title, description, notes, the prompt text and each skill text file. */
function fieldsOf(p: Prompt): { where: string; text: string }[] {
  const out = [
    { where: "title", text: p.title },
    { where: "description", text: p.description },
    { where: "how to use", text: p.notes },
  ];
  if (p.kind === "prompt") out.push({ where: "prompt", text: p.body });
  else {
    const files = p.files.filter((f) => !f.path);
    if (files.length) for (const f of files) out.push({ where: f.name, text: f.content });
    else out.push({ where: "SKILL.md", text: p.body });
  }
  return out.filter((f) => f.text);
}

function scanItem(p: Prompt, terms: string[]): Hit[] {
  const hits: Hit[] = [];
  for (const term of terms) {
    for (const f of fieldsOf(p)) {
      const m = termRe(term).exec(f.text);
      if (!m) continue;
      const from = Math.max(0, m.index - 70);
      const to = Math.min(f.text.length, m.index + m[0].length + 70);
      hits.push({ term, where: f.where, snippet: `${from ? "…" : ""}${f.text.slice(from, to).replace(/\s+/g, " ").trim()}${to < f.text.length ? "…" : ""}` });
      break; // first field per term is enough to show why
    }
  }
  return hits;
}

const SIGNAL = { pass: "✅ looks fine", warn: "⚠️ needs a look", check: "🔎 check by hand" } as const;

// ── Tools ───────────────────────────────────────────────────────────
export function registerEnablementTools(server: McpServer, ctx: EnablementContext) {
  const { service, library, traced } = ctx;
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    "top_items",
    {
      title: "Top prompts and skills",
      description:
        "The library's top items: by usage (run, installed or opened through Claude and other connected apps, counted per person) over a recent period, or by votes (upvotes and favorites, all time). Use for \"show me the top prompts\", \"what's most used by Sales\", \"popular skills this month\". Items Enablement flagged as outdated are listed last.",
      inputSchema: {
        by: z.enum(["usage", "votes"]).optional().describe("Default: usage"),
        days: z.number().int().min(1).max(365).optional().describe("Usage period in days. Default 30"),
        kind: z.enum(["prompt", "skill"]).optional(),
        app: z.string().optional(),
        team: z.string().optional(),
        limit: z.number().int().min(1).max(25).optional().describe("Default 10"),
      },
      annotations: readOnly,
    },
    traced("top_items", "browse", async ({ by, days, kind, app, team, limit }, ev) => {
      const l = await library();
      const n = limit ?? 10;
      const period = days ?? 30;
      const pool = applyFilters(l.items, { kind, app, team }, l).filter((p) => p.visibility === "public" || isMine(l, p));
      ev.filters = { by: by ?? "usage", days: period, kind, app, team };
      if (by === "votes") {
        const page = [...pool].sort((a, b) => compareOutdated(a, b) || popularity(b) - popularity(a) || b.updatedAt.localeCompare(a.updatedAt)).filter((p) => popularity(p) > 0).slice(0, n);
        ev.resultIds = page.map((p) => p.id);
        ev.resultCount = page.length;
        if (!page.length) {
          ev.outcome = "empty";
          return text("Nothing with those filters has upvotes or favorites yet.");
        }
        return text([`Top ${page.length} by upvotes and favorites:`, ...page.map((p) => summarize(l, p))].join("\n\n"));
      }
      const since = new Date(Date.now() - period * 86_400_000).toISOString();
      const { data, error } = await service.rpc("connector_usage", { p_since: since });
      if (error) return fail(`Usage isn't available right now (${error.message}). Try by: "votes".`);
      const usage = new Map(((data ?? []) as { prompt_id: string; runs: number; views: number; installs: number; people: number }[]).map((u) => [u.prompt_id, u]));
      const score = (p: Prompt) => {
        const u = usage.get(p.id);
        return u ? Number(u.runs) * 3 + Number(u.installs) * 3 + Number(u.views) + Number(u.people) * 2 : 0;
      };
      const page = pool.filter((p) => score(p) > 0).sort((a, b) => compareOutdated(a, b) || score(b) - score(a) || popularity(b) - popularity(a)).slice(0, n);
      ev.resultIds = page.map((p) => p.id);
      ev.resultCount = page.length;
      if (!page.length) {
        ev.outcome = "empty";
        return text(`Nothing with those filters was used through connected apps in the last ${period} days. Call again with by: "votes" for the most upvoted.`);
      }
      const why = (p: Prompt) => {
        const u = usage.get(p.id)!;
        return [Number(u.runs) ? plural(Number(u.runs), "run") : "", Number(u.installs) ? plural(Number(u.installs), "install") : "", Number(u.views) ? plural(Number(u.views), "open") : ""].filter(Boolean).join(", ") + ` by ${plural(Number(u.people), "person", "people")}`;
      };
      return text(
        [`Top ${page.length} by use through Claude and other connected apps, last ${period} days (usage on the site itself isn't counted):`, ...page.map((p) => summarize(l, p, why(p)))].join("\n\n"),
      );
    }),
  );

  server.registerTool(
    "leave_feedback",
    {
      title: "Leave feedback for an item's owner",
      description:
        "Posts feedback on a prompt or skill's page, as the connected person, and DMs the owner on Slack. Use for \"tell the owner…\", or during an impact scan when the owner should make the fix. Write it so the owner can act without asking: what's wrong, why (e.g. which product change), and the suggested fix. Show the person the exact text and only post after they say yes.",
      inputSchema: { id: idArg, text: z.string().min(1).max(4000).describe("The feedback, as the owner will read it") },
      annotations: writes,
    },
    traced("leave_feedback", "other", async ({ id, text: body }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      ev.detail = { feedback: true, chars: body.trim().length };
      const { error } = await service.from("feedback").insert({ prompt_id: p.id, user_id: ctx.me.id, text: body.trim() });
      if (error) return fail(`Not posted: ${error.message}`);
      after(() => notifyFeedbackPosted(service, p.id, ctx.me.id, body.trim()));
      return text(`Posted your feedback on "${p.title}"${p.ownerId === ctx.me.id ? "" : `; ${p.owner.name} gets a Slack DM`}: ${itemUrl(l, p)}#feedback`);
    }),
  );

  if (!ctx.enablement) return;

  server.registerTool(
    "list_use_cases",
    {
      title: "Enablement use cases and gold standards",
      description: "The jobs Enablement keeps a gold standard for (e.g. \"Account research\"), each with its gold standard item if it has one, and how many approved items cover it.",
      inputSchema: {},
      annotations: readOnly,
    },
    traced("list_use_cases", "review", async () => {
      const [l, all] = await Promise.all([library(), loadUseCases(service)]);
      const active = all.filter((u) => !u.archived);
      if (!active.length) return text(`No use cases yet.${ctx.reviewer ? " Add one with create_use_case." : ""}`);
      return text(
        [
          `${plural(active.length, "use case")}:`,
          ...active.map((u) => {
            const gold = u.gold_prompt_id ? findItem(l, u.gold_prompt_id) : undefined;
            const approved = l.items.filter((p) => p.approval.useCaseId === u.id && p.approval.tier !== "none" && p.approval.current && !p.approval.outdated).length;
            return `### ${u.name}\n- id: ${u.id}${u.description ? `\n- ${u.description}` : ""}\n- gold standard: ${gold ? `${gold.title} (${gold.id}) · ${itemUrl(l, gold)}` : "none yet"}\n- approved items: ${approved}`;
          }),
        ].join("\n\n"),
      );
    }),
  );

  server.registerTool(
    "audit_item",
    {
      title: "Audit a prompt or skill",
      description:
        "Use for \"help me audit this prompt\" or before approving or requesting a review. Returns Enablement's rubric with automatic signals (missing notes, leftover specifics, credentials or customer emails, age, duplicates), the gold standard to compare against, what changed since it was last approved, review history, feedback and connector usage, plus the full content. Saves nothing. Walk the person through each rubric item, give your own verdict per item with reasons, then suggest the next step.",
      inputSchema: { id: idArg },
      annotations: readOnly,
    },
    traced("audit_item", "review", async ({ id }, ev) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const [reviewsRes, useCases, feedbackRes, eventsRes] = await Promise.all([
        service.from("prompt_reviews").select(REVIEW_SELECT).eq("prompt_id", p.id).order("created_at", { ascending: false }).limit(20),
        loadUseCases(service),
        service.from("feedback").select("text, resolved, created_at").eq("prompt_id", p.id).order("created_at", { ascending: false }).limit(20),
        service.from("connector_events").select("action, outcome, user_id").eq("prompt_id", p.id).gte("created_at", since).limit(5000),
      ]);
      const reviews = (reviewsRes.data ?? []) as unknown as ReviewRow[];
      const open = reviews.find((r) => r.status === "requested");
      const useCaseId = open?.use_case_id ?? p.approval.useCaseId;
      const useCase = useCases.find((u) => u.id === useCaseId);
      const gold = useCase?.gold_prompt_id ? findItem(l, useCase.gold_prompt_id) : undefined;
      const similar = search(l, `${p.title} ${p.description}`, { kind: p.kind === "skill" ? "skill" : "prompt" }, 6)
        .map((h) => h.item)
        .filter((s) => s.id !== p.id && s.visibility === "public");
      const feedback = (feedbackRes.data ?? []) as { text: string; resolved: boolean; created_at: string }[];
      const openFeedback = feedback.filter((f) => !f.resolved);
      const events = (eventsRes.data ?? []) as { action: string; outcome: string; user_id: string | null }[];
      const used = events.filter((e) => e.outcome === "ok" && ["run", "install", "view"].includes(e.action));
      const runs = used.filter((e) => e.action === "run").length;
      const stuck = events.filter((e) => e.action === "run" && e.outcome === "needs_input").length;
      const checks = autoChecks(l, p, similar, gold, openFeedback.length);

      const approvedSnap = reviews.find((r) => r.status === "approved" && r.body_snapshot != null);
      let changes = "";
      if (approvedSnap && approvedSnap.body_snapshot !== p.body) {
        const d = diffLines(approvedSnap.body_snapshot ?? "", p.body);
        changes = d
          ? compactDiff(d)
              .map((x) => (x.op === "gap" ? `  … ${x.count} unchanged lines` : `${x.op === "add" ? "+" : x.op === "del" ? "-" : " "} ${x.text}`))
              .join("\n")
          : "Too long to diff here; compare on the item's page.";
      }

      const mine = isMine(l, p);
      const next = ctx.reviewer
        ? `Next: once the person has given their verdict per rubric item, offer decide_review (approve, approve as gold standard, request changes or decline) with the rubric filled in${p.approval.outdated ? ", or flag_outdated with outdated: false if it's current again" : ", or flag_outdated if it's out of date"}. Only save after they say yes.`
        : mine
          ? "Next: fix what the audit found (preview_changes → update_item), then offer request_review so Enablement looks at it."
          : `Next: they don't own it. They can leave feedback for ${p.owner.name} on its page, or save their own improved version (start_improving).`;

      return text(
        [
          `# Audit: ${p.title}`,
          summarize(l, p),
          `\n## Status\n- ${p.approval.tier !== "none" || p.approval.outdated ? approvalLine(p.approval) : "Not approved"}${open ? `\n- Review requested ${day(open.created_at)}${open.requester ? ` by ${open.requester.name}` : ""} (${REASON_LABELS[open.reason]})${open.request_note ? `: "${open.request_note}"` : ""}` : ""}${p.visibility !== "public" ? "\n- Private: only public items can be approved." : ""}\n- Use case: ${useCase?.name ?? "none picked"}${useCase ? "" : ` (options: ${useCaseList(useCases)})`}`,
          `\n## Rubric (automatic signals; your judgment decides)\n${checks.map((c) => `- **${c.label}** (${c.key}): ${SIGNAL[c.signal]}\n${c.evidence.map((e) => `  - ${e}`).join("\n")}`).join("\n")}`,
          `\n## Use through connected apps (last 90 days)\n- ${plural(runs, "run")}, ${used.length - runs} opens or installs, by ${plural(new Set(used.map((e) => e.user_id)).size, "person", "people")}${stuck ? `\n- ${stuck} time${stuck === 1 ? "" : "s"} people started it without all fill-ins` : ""}`,
          openFeedback.length ? `\n## Open feedback\n${openFeedback.slice(0, 5).map((f) => `- ${day(f.created_at)}: ${f.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}` : "",
          reviews.length ? `\n## Review history\n${reviews.slice(0, 6).map((r) => `- ${day(r.decided_at ?? r.created_at)} · ${r.status === "approved" && r.tier === "gold" ? "Made the gold standard" : STATUS_LABELS[r.status]}${r.reviewer ? ` · ${r.reviewer.name}` : ""}${r.decision_note ? `: "${r.decision_note.replace(/\s+/g, " ").slice(0, 200)}"` : ""}`).join("\n")}` : "",
          changes ? `\n## Changes since it was approved (${day(approvedSnap!.decided_at)})\n\`\`\`diff\n${changes}\n\`\`\`` : "",
          gold && gold.id !== p.id ? `\n## Gold standard to compare against\n${summarize(l, gold)}\n(get_prompt or get_skill with its id for the full text.)` : "",
          `\n## Content\n\n\`\`\`\`\n${contentOf(p).slice(0, 60_000) || "(link-only item; open it at its links)"}\n\`\`\`\``,
          `\n${next}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  server.registerTool(
    "request_review",
    {
      title: "Ask Enablement to review an item",
      description:
        "For the item's owner or editors: send a public prompt or skill to Enablement's review queue, with an optional use case and a note for the reviewer. Use when someone who isn't a reviewer asks to get their item approved. Confirm the note with the person first.",
      inputSchema: {
        id: idArg,
        use_case: z.string().optional().describe("Use case name or id (list_use_cases); omit to let Enablement pick"),
        note: z.string().max(2000).optional().describe("What it's for, what changed, how it was tested"),
      },
      annotations: writes,
    },
    traced("request_review", "review", async ({ id, use_case, note }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      const all = await loadUseCases(service);
      const uc = findUseCase(all, use_case);
      if (use_case && !uc) return fail(`No use case "${use_case}". Use cases: ${useCaseList(all)}.`);
      const r = await act(ctx, "request", { prompt: p.id, use_case: uc?.id ?? null, note: note ?? "" });
      if (!r.ok) {
        ev.outcome = "denied";
        return fail(`Not sent: ${r.error}`);
      }
      after(() => notifyRequest({ promptId: p.id, title: p.title, kind: p.kind, requester: ctx.me.name, note: note ?? "", useCase: uc?.name }));
      return text(`Sent "${p.title}" to Enablement for review${uc ? ` as ${uc.name}` : ""}. They'll get it in their queue, and the owner gets a Slack DM when it's decided: ${itemUrl(l, p)}`);
    }),
  );

  if (!ctx.reviewer) return;

  // ── Reviewers ─────────────────────────────────────────────────────
  server.registerTool(
    "review_queue",
    {
      title: "Enablement review queue",
      description:
        "For Enablement reviewers: items waiting for review (oldest first), approvals coming due, and items flagged as outdated. Use for \"show me prompts pending enablement review\". Then audit_item on one to review it.",
      inputSchema: {
        include: z.array(z.enum(["requests", "due", "outdated"])).optional().describe("Default: all three"),
        limit: z.number().int().min(1).max(50).optional().describe("Per section. Default 20"),
      },
      annotations: readOnly,
    },
    traced("review_queue", "review", async ({ include, limit }, ev) => {
      const want = new Set(include?.length ? include : ["requests", "due", "outdated"]);
      const n = limit ?? 20;
      const [l, all, openRes] = await Promise.all([
        library(),
        loadUseCases(service),
        want.has("requests") ? service.from("prompt_reviews").select(REVIEW_SELECT).eq("status", "requested").order("created_at", { ascending: true }).limit(200) : Promise.resolve({ data: [] }),
      ]);
      const ucName = (id: string | null) => all.find((u) => u.id === id)?.name;
      const sections: string[] = [];
      const shown: string[] = [];

      if (want.has("requests")) {
        const open = ((openRes.data ?? []) as unknown as ReviewRow[]).map((r) => ({ r, p: findItem(l, r.prompt_id) })).filter((x) => x.p);
        sections.push(
          `## Needs review (${open.length})\n\n${
            open
              .slice(0, n)
              .map(({ r, p }) => {
                shown.push(p!.id);
                return summarize(
                  l,
                  p!,
                  `${REASON_LABELS[r.reason]} · requested ${day(r.created_at)}${r.requester ? ` by ${r.requester.name}` : ""}${ucName(r.use_case_id) ? ` · use case ${ucName(r.use_case_id)}` : ""}${r.request_note ? ` · note: "${r.request_note.replace(/\s+/g, " ").slice(0, 200)}"` : ""}`,
                );
              })
              .join("\n\n") || "Nothing waiting."
          }`,
        );
      }
      if (want.has("due")) {
        const soon = Date.now() + DUE_SOON_DAYS * 86_400_000;
        const due = l.items
          .filter((p) => p.approval.tier !== "none" && p.approval.current && p.approval.dueAt && new Date(p.approval.dueAt).getTime() <= soon)
          .sort((a, b) => (a.approval.dueAt ?? "").localeCompare(b.approval.dueAt ?? ""));
        sections.push(`## Due for a periodic review (${due.length})\n\n${due.slice(0, n).map((p) => (shown.push(p.id), summarize(l, p, `review due ${day(p.approval.dueAt)}`))).join("\n\n") || "Nothing due in the next two weeks."}`);
      }
      if (want.has("outdated")) {
        const old = l.items.filter((p) => p.approval.outdated).sort((a, b) => (a.approval.outdated!.at ?? "").localeCompare(b.approval.outdated!.at ?? ""));
        sections.push(`## Flagged outdated (${old.length})\n\n${old.slice(0, n).map((p) => (shown.push(p.id), summarize(l, p, `flagged ${day(p.approval.outdated!.at)}; updated since: ${p.updatedAt > p.approval.outdated!.at ? "yes, worth a re-review" : "no"}`))).join("\n\n") || "None."}`);
      }
      ev.resultIds = shown;
      ev.resultCount = shown.length;
      ev.filters = { include: [...want] };
      return text(`${sections.join("\n\n")}\n\nThe same queue is at ${l.origin}/enablement.`);
    }),
  );

  server.registerTool(
    "decide_review",
    {
      title: "Approve, request changes or decline",
      description:
        "For Enablement reviewers: record a review decision on an item. approve (optionally as the gold standard for a use case), request_changes or decline (both need a note for the owner). Closes the open request if there is one, or records the review on its own. Approving also clears an outdated flag. Run audit_item first, and only call this once the person has explicitly confirmed the decision, note and rubric. The owner gets a Slack DM.",
      inputSchema: {
        id: idArg,
        decision: z.enum(["approve", "request_changes", "decline"]),
        gold: z.boolean().optional().describe("Approve as the gold standard for use_case (replaces the current one, which stays approved)"),
        use_case: z.string().optional().describe("Use case name or id; required with gold"),
        note: z.string().max(2000).optional().describe("For the owner. Required to request changes or decline"),
        rubric: rubricShape,
        due_days: z.union([z.literal(30), z.literal(90), z.literal(180)]).optional().describe(`When to review it again. Default ${DEFAULT_DUE_DAYS}`),
      },
      annotations: writes,
    },
    traced("decide_review", "review", async ({ id, decision, gold, use_case, note, rubric, due_days }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      ev.detail = { decision, gold: !!gold };
      if (decision !== "approve" && !note?.trim()) return fail("Add a note so the owner knows what to change.");
      const all = await loadUseCases(service);
      const uc = findUseCase(all, use_case);
      if (use_case && !uc) return fail(`No use case "${use_case}". Use cases: ${useCaseList(all)}. A reviewer can add one with create_use_case.`);
      if (gold && !uc) return fail(`Pick a use case for the gold standard. Use cases: ${useCaseList(all)}.`);
      const r = await act(ctx, "decide", {
        prompt: p.id,
        decision: decision === "approve" ? "approved" : decision === "request_changes" ? "changes_requested" : "declined",
        tier: decision === "approve" ? (gold ? "gold" : "approved") : null,
        use_case: uc?.id ?? null,
        note: note ?? "",
        rubric: rubricOf(rubric),
        due_days: due_days ?? DEFAULT_DUE_DAYS,
      });
      if (!r.ok) {
        ev.outcome = "denied";
        return fail(`Not saved: ${r.error}`);
      }
      const d: Decision = decision === "approve" ? (gold ? "gold" : "approved") : decision === "request_changes" ? "changes_requested" : "declined";
      after(() => notifyDecision({ to: [p.owner.email], promptId: p.id, title: p.title, decision: d, reviewer: ctx.me.name, note: note ?? "", useCase: uc?.name }));
      const said =
        d === "gold" ? `is now the gold standard for ${uc!.name}` : d === "approved" ? "is Enablement approved" : d === "changes_requested" ? "has changes requested" : "was not approved";
      return text(`"${p.title}" ${said}. ${p.owner.name} gets a Slack DM. ${itemUrl(l, p)}`);
    }),
  );

  server.registerTool(
    "set_gold_standard",
    {
      title: "Set the gold standard for a use case",
      description:
        "For Enablement reviewers: make an item the gold standard for a use case (the previous gold standard stays approved). If the item isn't approved in its current version yet, this approves it as gold, so pass the rubric from the audit. Only call after the person confirms. Use create_use_case first if the use case doesn't exist.",
      inputSchema: {
        id: idArg,
        use_case: z.string().min(1).describe("Use case name or id (list_use_cases)"),
        note: z.string().max(2000).optional(),
        rubric: rubricShape,
      },
      annotations: writes,
    },
    traced("set_gold_standard", "review", async ({ id, use_case, note, rubric }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      const all = await loadUseCases(service);
      const uc = findUseCase(all, use_case);
      if (!uc) return fail(`No use case "${use_case}". Use cases: ${useCaseList(all)}. Add it with create_use_case.`);
      if (p.approval.outdated) {
        ev.outcome = "denied";
        return fail(`"${p.title}" is flagged as outdated ("${p.approval.outdated.note}"). Clear the flag (flag_outdated with outdated: false) or re-approve it with decide_review first.`);
      }
      const previous = uc.gold_prompt_id && uc.gold_prompt_id !== p.id ? findItem(l, uc.gold_prompt_id) : undefined;
      const approvedNow = p.approval.tier !== "none" && p.approval.current;
      const r = approvedNow
        ? await act(ctx, "set_gold", { use_case: uc.id, prompt: p.id })
        : await act(ctx, "decide", { prompt: p.id, decision: "approved", tier: "gold", use_case: uc.id, note: note ?? "", rubric: rubricOf(rubric), due_days: DEFAULT_DUE_DAYS });
      if (!r.ok) {
        ev.outcome = "denied";
        return fail(`Not saved: ${r.error}`);
      }
      ev.detail = { use_case: uc.name, approved_too: !approvedNow };
      after(() => notifyDecision({ to: [p.owner.email], promptId: p.id, title: p.title, decision: "gold", reviewer: ctx.me.name, note: note ?? "", useCase: uc.name }));
      return text(`"${p.title}" is now the gold standard for ${uc.name}${approvedNow ? "" : " (and Enablement approved)"}.${previous ? ` "${previous.title}" stays Enablement approved.` : ""} ${itemUrl(l, p)}`);
    }),
  );

  server.registerTool(
    "create_use_case",
    {
      title: "Add a gold standard use case",
      description:
        "For Enablement reviewers: add a use case (a common job Enablement keeps a gold standard for, e.g. \"Discovery call prep\"). Optionally pass gold_item to make an item its gold standard straight away (it must be approved in its current version; otherwise use set_gold_standard after). Confirm the name with the person first.",
      inputSchema: {
        name: z.string().min(1).max(60).describe("Short, like a job title for the task: \"Account research\""),
        description: z.string().max(300).optional().describe("One line on what the job is"),
        gold_item: z.string().optional().describe("Optional: item id to make its gold standard"),
      },
      annotations: writes,
    },
    traced("create_use_case", "review", async ({ name, description, gold_item }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = gold_item ? findItem(l, gold_item) : undefined;
      if (gold_item && !p) {
        ev.outcome = "not_found";
        return notFound(gold_item);
      }
      const r = await act(ctx, "create_use_case", { name, description: description ?? "" });
      if (!r.ok) {
        ev.outcome = "denied";
        return fail(`Not added: ${r.error}`);
      }
      ev.detail = { use_case: name };
      if (!p) return text(`Added the use case "${name.trim()}". Make an item its gold standard with set_gold_standard.`);
      ev.promptId = p.id;
      const g = await act(ctx, "set_gold", { use_case: r.id, prompt: p.id });
      if (!g.ok) return text(`Added the use case "${name.trim()}", but "${p.title}" isn't its gold standard yet: ${g.error} Use set_gold_standard to approve it as gold.`);
      after(() => notifyDecision({ to: [p.owner.email], promptId: p.id, title: p.title, decision: "gold", reviewer: ctx.me.name, note: "", useCase: name.trim() }));
      return text(`Added the use case "${name.trim()}" with "${p.title}" as its gold standard: ${itemUrl(l, p)}`);
    }),
  );

  server.registerTool(
    "find_impacted",
    {
      title: "Find items a product update affects",
      description:
        "For Enablement reviewers, after a product update (renamed or retired feature, new pricing, a model change, new messaging): scans every public prompt and skill for the exact terms that changed, with the passage each was found in, plus items related to the update by topic. Before calling, ask the person what changed and turn it into exact terms: old names, old numbers, retired phrases (\"Claygent Neon\", \"$0.10 per credit\", \"Sculptor\"). Then go through the results with them and decide per item: leave_feedback (the owner fixes it), flag_outdated, or join_as_editor and fix it yourselves (preview_changes → update_item). Saves nothing.",
      inputSchema: {
        change: z.string().min(1).max(1000).describe("The product update in plain words"),
        terms: z.array(z.string().min(2).max(100)).max(25).optional().describe("Exact words, names or numbers that changed or were removed. The scan is only reliable with these"),
        kind: z.enum(["prompt", "skill"]).optional(),
        team: z.string().optional(),
        app: z.string().optional(),
        include_outdated: z.boolean().optional().describe("Also list items already flagged as outdated. Default false"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 25"),
      },
      annotations: readOnly,
    },
    traced("find_impacted", "review", async ({ change, terms, kind: k, team, app, include_outdated, limit }, ev) => {
      const l = await library();
      const n = limit ?? 25;
      const words = [...new Set((terms ?? []).map((t) => t.trim()).filter(Boolean))];
      const pool = applyFilters(l.items, { kind: k, team, app }, l).filter((p) => p.visibility === "public");
      const skippedOutdated = include_outdated ? 0 : pool.filter((p) => p.approval.outdated).length;
      const scan = include_outdated ? pool : pool.filter((p) => !p.approval.outdated);
      ev.query = change;
      ev.filters = { terms: words, kind: k, team, app, include_outdated };

      const exact = words.length
        ? scan
            .map((p) => ({ p, hits: scanItem(p, words) }))
            .filter((x) => x.hits.length)
            .sort((a, b) => b.hits.length - a.hits.length || popularity(b.p) - popularity(a.p))
        : [];
      const exactIds = new Set(exact.map((x) => x.p.id));
      const related = search(l, [change, ...words].join(" "), { kind: k, team, app }, 15)
        .filter((h) => !exactIds.has(h.item.id) && h.item.visibility === "public" && (include_outdated || !h.item.approval.outdated))
        .slice(0, Math.max(0, Math.min(10, n - Math.min(exact.length, n))));
      const shown = exact.slice(0, n);
      ev.resultIds = [...shown.map((x) => x.p.id), ...related.map((h) => h.item.id)];
      ev.resultCount = exact.length;
      if (!exact.length && !related.length) ev.outcome = "empty";

      const relation = (p: Prompt) => (isMine(l, p) ? " · you can edit it" : ` · owner ${p.owner.name}`);
      const parts = [
        `# Impact scan: ${change.replace(/\s+/g, " ").slice(0, 200)}`,
        `Scanned ${plural(scan.length, "public item")}${words.length ? ` for ${words.map((w) => `"${w}"`).join(", ")}` : ""}.${skippedOutdated ? ` ${skippedOutdated} already flagged outdated were skipped (include_outdated: true to list them).` : ""}`,
        !words.length ? "No exact terms were given, so this is a topic match only and can miss items. Ask the person for the old names, numbers or phrases and scan again." : "",
        words.length ? `\n## Mention the changed terms (${exact.length}${exact.length > n ? `, showing ${n}` : ""})\n\n${shown.map(({ p, hits }) => `${summarize(l, p, `mentions ${hits.map((h) => `"${h.term}"`).join(", ")}${relation(p)}`)}\n${hits.slice(0, 3).map((h) => `  - in ${h.where}: "${h.snippet}"`).join("\n")}`).join("\n\n") || "None."}` : "",
        related.length ? `\n## Possibly related by topic (check by hand)\n\n${related.map((h) => summarize(l, h.item, `${h.matched.length ? `matches ${h.matched.slice(0, 4).join(", ")}` : "related"}${relation(h.item)}`)).join("\n\n")}` : "",
        `\nNext: go through these with the person, one line each with your suggestion. For each, they can leave_feedback for the owner (say what changed and the fix), flag_outdated with a note, or join_as_editor and fix it here (preview_changes → update_item). Confirm in one message before writing anything, then make the calls.`,
      ];
      return text(parts.filter(Boolean).join("\n"));
    }),
  );

  server.registerTool(
    "join_as_editor",
    {
      title: "Add yourself as an editor",
      description:
        "For Enablement reviewers: become an editor of a public prompt or skill so you can fix it yourself (for example after a product update), then use preview_changes and update_item as usual. The owner gets a Slack DM. Private items need the owner to add you. Editing approved content sends it back for a re-review. Confirm with the person first.",
      inputSchema: { id: idArg },
      annotations: { ...writes, idempotentHint: true },
    },
    traced("join_as_editor", "edit", async ({ id }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      const r = await act(ctx, "join_editor", { prompt: p.id });
      if (!r.ok) {
        ev.outcome = "denied";
        return fail(`Not added: ${r.error}`);
      }
      ev.detail = { joined: !!r.joined };
      if (!r.joined) return text(`You can already edit "${p.title}". Use preview_changes with id ${p.id}.`);
      after(() => notifyDecision({ to: [p.owner.email], promptId: p.id, title: p.title, decision: "editor_joined", reviewer: ctx.me.name, note: "" }));
      return text(`You're now an editor of "${p.title}" (${p.owner.name} gets a Slack DM). Make the change with preview_changes (id ${p.id}, only the fields that change), show it, then update_item once they say yes.${p.approval.tier !== "none" ? " It's Enablement approved, so changing its content queues a re-review; approve it again with decide_review when you're happy." : ""}`);
    }),
  );

  server.registerTool(
    "flag_outdated",
    {
      title: "Flag an item as outdated",
      description:
        "For Enablement reviewers: flag a prompt or skill as out of date, with a note on what's wrong (old pricing, a renamed feature, a better way now). Everyone sees a warning on its page, it's listed after current items in Discover, Claude and Slack, it stops being a gold standard, and the owner gets a Slack DM. Pass outdated: false to clear the flag. Approving the item again also clears it. Confirm with the person first.",
      inputSchema: {
        id: idArg,
        note: z.string().max(2000).optional().describe("What's out of date. Required when flagging"),
        outdated: z.boolean().optional().describe("Default true; false clears the flag"),
      },
      annotations: { ...writes, idempotentHint: true },
    },
    traced("flag_outdated", "review", async ({ id, note, outdated }, ev) => {
      if (!ctx.canWrite) return { ...ctx.reconnect(), isError: true as const };
      const l = await library();
      const p = findItem(l, id);
      if (!p) {
        ev.outcome = "not_found";
        return notFound(id);
      }
      ev.promptId = p.id;
      const flag = outdated ?? true;
      ev.detail = { outdated: flag };
      if (flag && !note?.trim()) return fail("Say what's out of date, so the owner knows what to fix.");
      const r = await act(ctx, "set_outdated", { prompt: p.id, outdated: flag, note: note ?? "" });
      if (!r.ok) {
        ev.outcome = "denied";
        return fail(`Not saved: ${r.error}`);
      }
      if (flag) after(() => notifyDecision({ to: [p.owner.email], promptId: p.id, title: p.title, decision: "outdated", reviewer: ctx.me.name, note: note ?? "" }));
      return text(
        flag
          ? `Flagged "${p.title}" as outdated.${p.approval.tier === "gold" ? ` It's no longer the gold standard${p.approval.useCase ? ` for ${p.approval.useCase}` : ""}; pick a replacement with set_gold_standard.` : ""} ${p.owner.name} gets a Slack DM. ${itemUrl(l, p)}`
          : `Cleared the outdated flag on "${p.title}". It ranks normally again. ${itemUrl(l, p)}`,
      );
    }),
  );

  server.registerTool(
    "usage_report",
    {
      title: "Connector usage report",
      description:
        "For Enablement reviewers: how the library is used through Claude and other connected apps over a period. Most-run items, searches that found nothing (content gaps), items people start without all their fill-ins, outdated items still in use, use by connected app, and approved vs community share of runs.",
      inputSchema: { days: z.number().int().min(1).max(365).optional().describe("Default 30") },
      annotations: readOnly,
    },
    traced("usage_report", "report", async ({ days }, ev) => {
      const period = days ?? 30;
      ev.filters = { days: period };
      const since = new Date(Date.now() - period * 86_400_000).toISOString();
      const [l, res] = await Promise.all([
        library(),
        service.from("connector_events").select("action, outcome, prompt_id, query, user_id, client_name").gte("created_at", since).order("created_at", { ascending: false }).limit(20_000),
      ]);
      if (res.error) return fail(`Usage isn't available right now: ${res.error.message}`);
      const rows = (res.data ?? []) as { action: string; outcome: string; prompt_id: string | null; query: string | null; user_id: string | null; client_name: string }[];
      if (!rows.length) return text(`No connector activity in the last ${period} days.`);
      const count = <K>(xs: K[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<K, number>())].sort((a, b) => b[1] - a[1]);
      const title = (id: string) => findItem(l, id)?.title ?? "(an item you can't see)";
      const runs = rows.filter((r) => r.action === "run" && r.outcome === "ok" && r.prompt_id);
      const topRuns = count(runs.map((r) => r.prompt_id!)).slice(0, 10);
      const gaps = count(rows.filter((r) => r.action === "search" && r.outcome === "empty" && r.query).map((r) => r.query!.trim().toLowerCase())).slice(0, 15);
      const stuck = count(rows.filter((r) => r.action === "run" && r.outcome === "needs_input" && r.prompt_id).map((r) => r.prompt_id!)).slice(0, 5);
      const outdatedUse = count(rows.filter((r) => r.prompt_id && ["run", "install", "view"].includes(r.action) && findItem(l, r.prompt_id)?.approval.outdated).map((r) => r.prompt_id!)).slice(0, 10);
      const clients = count(rows.map((r) => r.client_name || "unknown"));
      const approvedRuns = runs.filter((r) => {
        const p = findItem(l, r.prompt_id!);
        return p && p.approval.tier !== "none" && p.approval.current && !p.approval.outdated;
      }).length;
      const people = new Set(rows.map((r) => r.user_id)).size;
      const searches = rows.filter((r) => r.action === "search").length;
      return text(
        [
          `# Connector usage, last ${period} days`,
          `- ${plural(rows.length, "tool call")} by ${plural(people, "person", "people")}; ${plural(searches, "search", "searches")}, ${plural(runs.length, "prompt run")}.`,
          runs.length ? `- ${Math.round((approvedRuns / runs.length) * 100)}% of runs were of Enablement approved or gold standard items.` : "",
          `\n## Most run\n${topRuns.map(([id, n]) => `- ${title(id)} (${id}): ${plural(n, "run")}`).join("\n") || "None."}`,
          `\n## Searches that found nothing (content gaps)\n${gaps.map(([q, n]) => `- "${q}"${n > 1 ? ` × ${n}` : ""}`).join("\n") || "None."}`,
          stuck.length ? `\n## Started without all fill-ins (the fill-ins may be unclear)\n${stuck.map(([id, n]) => `- ${title(id)} (${id}): ${n}×`).join("\n")}` : "",
          outdatedUse.length ? `\n## Outdated items still being used\n${outdatedUse.map(([id, n]) => `- ${title(id)} (${id}): ${n}×`).join("\n")}` : "",
          `\n## By connected app\n${clients.map(([c, n]) => `- ${c}: ${n}`).join("\n")}`,
          `\nRaw data: the connector_events table and the connector_item_usage and connector_search_gaps views in Supabase.`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );
}
