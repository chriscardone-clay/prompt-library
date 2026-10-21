import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { activeApps, activeTeams } from "@/lib/catalog";
import { SKILL_TEMPLATE } from "@/lib/constants";
import { fillBody, parsePlaceholders } from "@/lib/placeholders";
import { skillMd, skillSlug } from "@/lib/skills";
import { browse, claudeLink, findItem, installNotes, isMine, type Library, loadLibrary, search, skillFiles, summarize } from "./library";
import type { Prompt } from "@/lib/types";
import { itemShape, prepare, previewText, saveItem } from "./create";
import { editPreviewText, editShape, prepareEdit, saveEdit } from "./edit";
import { itemUrl } from "./library";
import { type McpUser, WRITE_SCOPE } from "./oauth";
import { recommend } from "./recommend";

const INSTRUCTIONS = `Clay's internal prompt library (ClayPrompts): prompts (text you paste into Claude, ChatGPT, Town, Claygent, Monty, Granola…), skills (SKILL.md bundles installed into a tool) and workflows, written by people at Clay and reviewed by Enablement. Think of it as the person's own repository of what works, shared with their team.

Finding
- For a task, call search_library with the task in plain words; browse_library lists by app, team or popularity.
- "My prompt for X", "pull my …", "the one I saved": search_library with mine: true. That covers their private items too.
- Items marked "Gold standard" or "Enablement approved" were reviewed by Clay's Enablement team and come first in results. When one fits, recommend it first and say Enablement recommends it. Only pass over it for a clearly better fit.

Using
- "Run that prompt", "use it": call run_prompt. Ask for every missing fill-in in one short message (use what you already know from the chat first), call run_prompt again with the values, then carry out the returned prompt right here in the conversation.
- "Install that skill": call install_skill with where they work. If the skill has a claude.ai link, send them there; don't rebuild it from files. In Claude Code, write the files only after they say yes.

Saving and improving
- "Save this" / "add this to my library": start_saving, draft it, confirm the details (private by default when they say "my library"), preview_item, then create_item after they say yes.
- "Learn from this chat", "make that prompt better next time": call start_improving with the item's id and follow it. Owners and editors update the item (preview_changes → update_item). Anyone else saves their own private version linked to the original (create_item with forked_from).
- Other changes to their own items ("make it public", "add Sales as a team"): preview_changes with only the fields that change, then update_item (with based_on) after they say yes. Nothing can be deleted from chat.

Be proactive, briefly and at most once per topic:
- After you run a library prompt and the person corrected or refined the result, offer to fold those changes back in (start_improving).
- When a session produced something reusable and nothing in the library covers it, offer to save it.
- When the person starts a task the library clearly covers, mention the item.

Always give links so they can open, upvote or fork. Never invent items; only use what the tools return.`;

const kind = z.enum(["prompt", "skill"]).optional().describe("Only prompts or only skills");
const app = z.string().optional().describe("Only items built for this app, e.g. Claude, Town, ChatGPT, Claygent, Granola");
const team = z.string().optional().describe("Only items for this team, e.g. GTM, Sales, CS");
const approved_only = z.boolean().optional().describe("Only gold standards and Enablement approved items");
const mine = z.boolean().optional().describe("Only items the person owns or edits, private ones included. Use for \"my prompt for…\"");

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function promptText(l: Library, p: Prompt, values?: Record<string, string>): string {
  const body = p.kind === "skill" ? skillMd(p.files) || p.body : p.body;
  const keys = p.kind === "prompt" ? parsePlaceholders(body) : [];
  const filled = values && keys.length ? fillBody(body, values) : body;
  const missing = keys.filter((k) => !values?.[k]?.trim());
  return [
    summarize(l, p),
    p.notes ? `\n## How to use\n${p.notes}` : "",
    p.links.length ? `\n## Where it's saved\n${p.links.map((x) => `- ${x.label || x.url}: ${x.url}`).join("\n")}` : "",
    keys.length ? `\n## Fill-ins\n${keys.map((k) => `- ${k}${values?.[k]?.trim() ? ` = ${values[k]}` : " (not filled)"}`).join("\n")}` : "",
    `\n## ${p.kind === "skill" ? "SKILL.md" : values && keys.length ? "Prompt (filled)" : "Prompt"}\n\n${filled || "(This item is link-only; open it where it's saved.)"}`,
    missing.length && values ? `\nStill unfilled: ${missing.join(", ")}. Ask the person for these or fill them from context.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function skillText(l: Library, p: Prompt): string {
  const files = skillFiles(p);
  const install = installNotes(l, p);
  const cl = claudeLink(p);
  return [
    summarize(l, p),
    cl ? `\n## Already in Claude\nThis skill is published in Claude: ${cl.url}\nTo install it in Claude, send the person to that link rather than recreating it from the files below.` : "",
    p.notes ? `\n## How to use\n${p.notes}` : "",
    p.links.length ? `\n## Open it where it lives\n${p.links.map((x) => `- ${x.label || x.url}: ${x.url}`).join("\n")}` : "",
    install.length ? `\n## Install\n${install.join("\n")}\n- Or download the .skill bundle from ${itemUrl(l, p)}` : `\n## Install\nDownload the .skill bundle from ${itemUrl(l, p)}`,
    `\nFolder name: ${skillSlug(p.title, p.files)}`,
    ...files.text.map((f) => `\n## File: ${f.name}${f.truncated ? " (truncated)" : ""}\n\n\`\`\`\`\n${f.content}\n\`\`\`\``),
    files.binary.length ? `\nBinary files (in the .skill download only): ${files.binary.join(", ")}` : "",
    files.omitted.length ? `\nNot shown (size limit; in the .skill download): ${files.omitted.join(", ")}` : "",
    !p.files.length && !p.links.length ? "\nThis skill has no files or links." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The walkthrough for saving a session's work as a prompt or skill. */
function savingGuide(l: Library): string {
  const apps = activeApps(l.catalog)
    .map((a) => `- ${a.name}${a.surfaces.length ? ` (surfaces: ${a.surfaces.map((s) => s.name).join(", ")})` : ""}${a.modelHint ? ` · model example: ${a.modelHint.replace(/^e\.g\.\s*/i, "")}` : ""}`)
    .join("\n");
  const teams = activeTeams(l.catalog).map((t) => t.name).join(", ");
  return `# Saving to the Clay prompt library

Walk the person through this. Keep it quick: propose your best guess for every field so they can mostly say "yes".

## 1. Work out what made this session work
Look back over the conversation: the instructions that got good results, the inputs it needed, the steps, the output format, the corrections they made along the way. That is what to capture, not the transcript.

## 2. Prompt or skill?
- **Prompt**: one instruction people paste into a tool and fill in. Best when the value is in the wording.
- **Skill**: a SKILL.md (frontmatter name + description, then when-to-use, steps, output format) plus optional reference files, installed into Claude or ChatGPT. Best for a repeatable multi-step procedure, house style, or reference material the tool should follow every time.

## 3. Draft it, generalised
- Replace this session's specifics (customer, person, deal, numbers, dates) with {{placeholders}} such as {{company}}, {{transcript}}, {{persona}}.
- Remove anything confidential (customer data, internal figures) unless it belongs in the template.
- Keep the parts that made it work: the constraints, the format, the examples.
- Add "How to use" notes: when to reach for it, what to paste in, connectors it needs, tips.
- For a skill, start SKILL.md like this:
\`\`\`
${SKILL_TEMPLATE}\`\`\`

## 4. Confirm the details with the person (one message)
- Title (short, searchable) and one-sentence description
- Where it works (apps below; add a model only if it mattered, and whether it's required or just recommended)
- Which team(s) it's for: ${teams}
- Public (everyone at Clay can find it) or private (just them and any editors). Always ask; never assume.
- Optional: teammates who should be able to edit it, and links to where it lives (a Claude project, a custom GPT)

Apps:
${apps}

## 5. Preview, then save
- Call preview_item and show them the result, including any "worth fixing" notes and similar items that already exist. If one of those already does the job, suggest upvoting or forking it instead.
- Only after they clearly say yes, call create_item with exactly what they approved. Then share the link and suggest opening it to check it or upload binary files (fonts, images), which the connector can't do. If they want changes afterwards, use preview_changes and update_item.

Saving as: ${l.me.name} <${l.me.email}>.`;
}

/**
 * One server per request (stateless). The library is read lazily and at most
 * once per request, as the person behind the token.
 */
export function buildServer(service: SupabaseClient, me: McpUser, origin: string): McpServer {
  let lib: Promise<Library> | null = null;
  const library = () => (lib ??= loadLibrary(service, me, origin));

  const server = new McpServer({ name: "clay-prompt-library", title: "Clay prompt library", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    "search_library",
    {
      title: "Search the prompt library",
      description:
        "Ranked search over prompts and skills by what they do. Pass the task in plain words (\"recap a customer call for Slack\", \"Clay formula to score accounts\"). Gold standards and Enablement approved items that match come first. mine: true searches only the person's own items, private ones included. Returns compact cards with ids; use run_prompt to run a prompt, install_skill to install a skill.",
      inputSchema: { query: z.string().min(1).describe("What the person wants to do"), kind, app, team, approved_only, mine, limit: z.number().int().min(1).max(20).optional() },
      annotations: readOnly,
    },
    async ({ query, kind, app, team, approved_only, mine: mineOnly, limit }) => {
      const l = await library();
      const hits = search(l, query, { kind, app, team, approvedOnly: approved_only, mine: mineOnly }, limit ?? 8);
      if (!hits.length) {
        return text(
          `Nothing ${mineOnly ? "in your own library" : "in the library"} matches "${query}"${kind || app || team || approved_only ? " with those filters" : ""}. Try fewer words or no filters, or browse_library. If the person writes one that works, they can add it at ${l.origin}/prompts/new so the next person finds it.`,
        );
      }
      return text(
        [`${hits.length} result${hits.length === 1 ? "" : "s"} for "${query}", best first:`, ...hits.map((h) => summarize(l, h.item, h.matched.length ? `matches ${h.matched.slice(0, 5).join(", ")}` : undefined))].join("\n\n"),
      );
    },
  );

  server.registerTool(
    "browse_library",
    {
      title: "Browse the prompt library",
      description:
        "List prompts and skills, optionally filtered by kind, app or team, sorted by recommended (gold standards, then Enablement approved, then most upvoted), top (most upvoted/favorited), new, or updated. Use search_library when you have a task in mind.",
      inputSchema: {
        kind,
        app,
        team,
        approved_only,
        sort: z.enum(["recommended", "top", "new", "updated"]).optional().describe("Default: recommended when Enablement approvals are on for this person, else top"),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    async ({ kind, app, team, approved_only, sort, limit, offset }) => {
      const l = await library();
      const n = limit ?? 15;
      const from = offset ?? 0;
      const { total, page } = browse(l, { kind, app, team, approvedOnly: approved_only }, sort ?? (l.enablement ? "recommended" : "top"), n, from);
      if (!total) return text("No items match those filters. Call list_catalog to see the app and team names in use.");
      const more = from + page.length < total ? `\n\n${total - from - page.length} more: call again with offset ${from + page.length}.` : "";
      return text([`${total} item${total === 1 ? "" : "s"}; showing ${from + 1}–${from + page.length}:`, ...page.map((p) => summarize(l, p))].join("\n\n") + more);
    },
  );

  server.registerTool(
    "get_prompt",
    {
      title: "Get a prompt",
      description:
        "Full text of a prompt, its how-to-use notes, model guidance and where it's saved. Prompts may contain {{fill-ins}}; pass values to get the text filled in, ready to use. Works for skills too (returns SKILL.md), but get_skill gives every file.",
      inputSchema: {
        id: z.string().min(1).describe("Item id (or its clayprompts.com link)"),
        values: z.record(z.string(), z.string()).optional().describe("Fill-in values keyed by placeholder name, e.g. {\"company\": \"Acme\"}"),
      },
      annotations: readOnly,
    },
    async ({ id, values }) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) return { ...text(`No item with id ${id} that you can see. Search again with search_library.`), isError: true };
      return text(promptText(l, p, values));
    },
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get a skill",
      description:
        "A skill's files (SKILL.md first, then references and scripts), its links, and install steps per app. In Claude Code you can install it by writing the files to ~/.claude/skills/<folder>/ (folder name given in the result) after the person agrees. Binary files (fonts, images) are listed by name only; they come with the .skill download on the item's page.",
      inputSchema: { id: z.string().min(1).describe("Skill id (or its clayprompts.com link)") },
      annotations: readOnly,
    },
    async ({ id }) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) return { ...text(`No item with id ${id} that you can see. Search again with search_library.`), isError: true };
      if (p.kind !== "skill") return text(`That's a prompt, not a skill. Use get_prompt.\n\n${summarize(l, p)}`);
      return text(skillText(l, p));
    },
  );

  server.registerTool(
    "recommend_for_me",
    {
      title: "Recommend prompts and skills for me",
      description: `Answers "what prompts and skills am I missing out on?". Before calling, build a profile of the person from everything you know about them: your memory of past conversations, their stated role and team, the work they do repeatedly, tools they use, current goals and frustrations. Summarise work-relevant facts only (no personal or sensitive details). If you know little, ask them two or three quick questions first, or call with what you have. The profile is used for this call only and not stored. Results skip items they created, favorited or upvoted, and anything listed in already_using. Explain each pick in terms of their work, and mention gaps (work nothing covers yet) as ideas they could add to the library.`,
      inputSchema: {
        role: z.string().max(200).optional().describe("Their job, e.g. \"Enterprise AE\", \"GTM engineer\""),
        team: z.string().max(100).optional().describe("Their team, matched to the library's teams (call list_catalog for names)"),
        recurring_work: z.array(z.string().max(300)).max(15).optional().describe("Tasks they do again and again, one per entry, e.g. \"prep for discovery calls\", \"write Clay formulas\""),
        goals: z.array(z.string().max(300)).max(10).optional().describe("What they're trying to achieve right now"),
        pain_points: z.array(z.string().max(300)).max(10).optional().describe("What slows them down or annoys them"),
        tools: z.array(z.string().max(60)).max(15).optional().describe("Apps they use, e.g. Claude, Granola, Town, Gmail"),
        already_using: z.array(z.string().max(200)).max(30).optional().describe("Names of prompts or skills they already use, so they're skipped"),
        limit: z.number().int().min(1).max(15).optional().describe("Default 8"),
      },
      annotations: readOnly,
    },
    async ({ limit, ...about }) => {
      const l = await library();
      const r = recommend(l, about, limit ?? 8);
      const parts: string[] = [];
      if (r.picks.length) {
        parts.push(`${r.picks.length} pick${r.picks.length === 1 ? "" : "s"} for this person, best first:`);
        for (const p of r.picks) parts.push(summarize(l, p.item, p.why));
      } else {
        parts.push("Nothing in the library fits this profile yet.");
      }
      if (r.gaps.length) parts.push(`\nNot covered by anything in the library yet: ${r.gaps.map((g) => `"${g}"`).join(", ")}. Suggest they add a prompt or skill for it at ${l.origin}/prompts/new.`);
      if (r.skipped.length) parts.push(`\nAlready theirs (skipped): ${r.skipped.slice(0, 12).map((s) => `${s.item.title} (${s.reason})`).join("; ")}${r.skipped.length > 12 ? `; and ${r.skipped.length - 12} more` : ""}.`);
      if (!about.recurring_work?.length && !about.goals?.length && !about.pain_points?.length) {
        parts.push("\nThe profile had no recurring work, goals or pain points, so these are mostly popular picks. Ask what they spend their week on for sharper recommendations.");
      }
      return text(parts.join("\n\n"));
    },
  );

  server.registerTool(
    "run_prompt",
    {
      title: "Run a prompt in this chat",
      description:
        "Use when the person wants to run a library prompt right here (\"run that prompt\", \"use it for Acme\"). Without all fill-ins it returns what to ask for; ask in one short message (fill what you already know from the chat first), then call again with values. With everything filled it returns the final prompt for you to carry out in this conversation.",
      inputSchema: {
        id: z.string().min(1).describe("Prompt id (or its clayprompts.com link)"),
        values: z.record(z.string(), z.string()).optional().describe("Fill-in values keyed by placeholder name, e.g. {\"company\": \"Acme\"}"),
      },
      annotations: readOnly,
    },
    async ({ id, values }) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) return { ...text(`No item with id ${id} that you can see. Search again with search_library.`), isError: true };
      if (p.kind !== "prompt") return text(`"${p.title}" is a ${p.kind}, not a prompt. ${p.kind === "skill" ? "Use install_skill to set it up." : "Open it on the site."}\n\n${summarize(l, p)}`);
      if (!p.body.trim()) return text(`"${p.title}" has no prompt text here; it lives elsewhere: ${p.links.map((x) => x.url).join(", ") || itemUrl(l, p)}`);
      const keys = parsePlaceholders(p.body);
      const missing = keys.filter((k) => !values?.[k]?.trim());
      if (missing.length) {
        return text(
          [
            `"${p.title}" needs ${missing.length === 1 ? "one fill-in" : `${missing.length} fill-ins`} before it can run: ${missing.map((k) => `{{${k}}}`).join(", ")}.`,
            p.notes ? `\nHow to use (from the author):\n${p.notes}` : "",
            `\nFill any you can from this conversation. Ask the person for the rest in one short message (a numbered list, one line each), then call run_prompt again with all values.`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      const filled = values && keys.length ? fillBody(p.body, values) : p.body;
      return text(
        [
          `Run this now: carry out the prompt below in this conversation, as if the person had just sent it. Don't show it back to them first.`,
          p.apps.some((a) => a.model && a.required) ? `Note: the author says it needs ${p.apps.filter((a) => a.required && a.model).map((a) => `${a.app} ${a.model}`).join(", ")}.` : "",
          `Afterwards, if they refine the result, offer once to save those improvements to the library (start_improving with id ${p.id}).`,
          `\n---\n${filled}\n---`,
          `\nSource: ${p.title} · ${itemUrl(l, p)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "install_skill",
    {
      title: "Install a skill",
      description:
        "Use when the person wants to install a skill from the library. Pass where they'll use it. If the skill is already published in Claude (a claude.ai link), this sends them there instead of rebuilding it. In Claude Code you'll get exact file paths to write (ask first). Elsewhere you'll get a one-click .skill download and the steps for that app.",
      inputSchema: {
        id: z.string().min(1).describe("Skill id (or its clayprompts.com link)"),
        where: z.enum(["claude", "claude_code", "chatgpt", "other"]).describe("claude = Claude web, desktop or mobile; claude_code = Claude Code; chatgpt; other"),
      },
      annotations: readOnly,
    },
    async ({ id, where }) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) return { ...text(`No item with id ${id} that you can see. Search again with search_library.`), isError: true };
      if (p.kind !== "skill") return text(`"${p.title}" is a ${p.kind}, not a skill.${p.kind === "prompt" ? " Use run_prompt to run it here." : ""}`);
      const slug = skillSlug(p.title, p.files);
      const cl = claudeLink(p);
      const bundle = `${l.origin}/prompts/${p.id}/skill`;
      const install = installNotes(l, p);
      const files = skillFiles(p);
      if (cl && where === "claude") {
        return text(
          `"${p.title}" is already published in Claude, so install it from there and it stays in sync with the original: ${cl.url}\nTell the person to open that link and add the skill. Don't rebuild it from files.`,
        );
      }
      if (where === "claude_code") {
        if (!files.text.length && !files.binary.length) return text(`"${p.title}" has no files to install.${cl ? ` It lives in Claude: ${cl.url}` : ""}`);
        return text(
          [
            cl ? `This skill is also published in Claude (${cl.url}). If they use Claude on the web or desktop too, suggest adding it from there.` : "",
            `Install "${p.title}" for Claude Code by writing these files under ~/.claude/skills/${slug}/ (or .claude/skills/${slug}/ in a project, if they prefer). Ask before writing anything. After writing, tell them to restart Claude Code or run /skills to see it.`,
            ...files.text.map((f) => `\n### ~/.claude/skills/${slug}/${f.name}${f.truncated ? " (truncated: download the bundle instead)" : ""}\n\n\`\`\`\`\n${f.content}\n\`\`\`\``),
            files.binary.length || files.omitted.length ? `\nNot included here (${[...files.binary, ...files.omitted].join(", ")}): download the full bundle from ${bundle} and unzip it into ~/.claude/skills/.` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      if (!p.files.length) return text(`"${p.title}" has no files to install.${p.links.length ? ` Open it where it lives: ${p.links.map((x) => x.url).join(", ")}` : ""}`);
      return text(
        [
          `Install "${p.title}":`,
          `1. Download the bundle: ${bundle} (they'll need to be signed in to ClayPrompts).`,
          install.length ? `2. Then:\n${install.join("\n")}` : where === "claude" ? `2. In Claude, open Settings → Capabilities → Skills, choose Upload skill and pick ${slug}.skill.` : `2. Add it in their tool's skills or custom instructions settings.`,
          `\nOffer to walk them through it, and once it's installed, to try it on something real.`,
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "start_improving",
    {
      title: "Improve a prompt or skill from this chat",
      description:
        "Use when the person wants the library item they just used to work better next time (\"learn from this chat\", \"update the prompt with what we changed\"), or when you offer after they refined a result. Returns how to fold this chat's improvements in: owners and editors update the item, anyone else saves their own linked private version. Saves nothing.",
      inputSchema: { id: z.string().min(1).describe("The item's id (or link)") },
      annotations: readOnly,
    },
    async ({ id }) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) return { ...text(`No item with id ${id} that you can see.`), isError: true };
      const own = isMine(l, p);
      const current = p.kind === "skill" ? skillText(l, p) : promptText(l, p);
      return text(
        [
          `# Improving "${p.title}" from this chat`,
          `1. Look back at what happened after the item was used: the corrections the person made, the instructions they added, the format they settled on, what they asked you to redo. Those are the improvements. Leave out one-off specifics (names, numbers, dates); keep or add {{placeholders}} instead.`,
          `2. Write the improved ${p.kind === "skill" ? "SKILL.md / files" : "prompt text"} in full, and say in 2–4 bullets what changed and why.`,
          own
            ? `3. They ${p.ownerId === l.me.id ? "own" : "edit"} this item. Call preview_changes with id ${p.id} and only the fields that change, show them the result, and call update_item (with based_on) once they say yes. The old version stays in its history.`
            : `3. They don't own this item (${p.owner.name} does). Offer to save their own version: call preview_item with the improved text, visibility private (unless they want it public), and forked_from ${p.id} plus a short fork_note, then create_item once they say yes. It's linked to the original, so ${p.owner.name} can see the variant. Mention they can also leave feedback for the owner on the item's page.`,
          l.enablement && p.approval.tier !== "none" ? `\nNote: this item is Enablement approved. ${own ? "Changing its content sends it back to Enablement for a re-review." : "Their own version won't carry the approval."}` : "",
          `\n## Current version\n${current}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "my_library",
    {
      title: "My favorites and creations",
      description: "Items the person created, edits, or saved to favorites on ClayPrompts, private ones included. To find one by what it does, use search_library with mine: true.",
      inputSchema: { which: z.enum(["favorites", "created", "both"]).optional().describe("Default: both") },
      annotations: readOnly,
    },
    async ({ which }) => {
      const l = await library();
      const w = which ?? "both";
      const fav = l.items.filter((p) => p.favoritedBy.includes(me.id));
      const mine = l.items.filter((p) => p.ownerId === me.id || p.editors.some((e) => e.id === me.id || e.email === me.email));
      const sections: string[] = [];
      if (w !== "created") sections.push(`## Favorites (${fav.length})\n\n${fav.map((p) => summarize(l, p)).join("\n\n") || "None yet."}`);
      if (w !== "favorites") sections.push(`## Created or editing (${mine.length})\n\n${mine.map((p) => summarize(l, p)).join("\n\n") || "None yet."}`);
      return text(sections.join("\n\n"));
    },
  );

  server.registerTool(
    "list_catalog",
    {
      title: "Apps and teams",
      description: "The apps (with surfaces) and teams the library is organised by, with item counts. Use the exact names as filters.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const l = await library();
      const count = (f: (p: (typeof l.items)[number]) => boolean) => l.items.filter(f).length;
      const apps = activeApps(l.catalog).map(
        (a) => `- ${a.name} (${count((p) => p.apps.some((x) => x.app === a.name))})${a.surfaces.length ? `: ${a.surfaces.map((s) => s.name).join(", ")}` : ""}`,
      );
      const teams = activeTeams(l.catalog).map((t) => `- ${t.name} (${count((p) => p.audiences.includes(t.name))})`);
      const prompts = count((p) => p.kind === "prompt");
      return text(`${l.items.length} items you can see: ${prompts} prompts, ${l.items.length - prompts} skills.\n\n## Apps\n${apps.join("\n")}\n\n## Teams\n${teams.join("\n")}`);
    },
  );

  // ── Saving to the library ──────────────────────────────────────────
  const canWrite = me.scope.split(" ").includes(WRITE_SCOPE);
  const reconnect = () => ({
    ...text("This connection can only read the library. Disconnect it on ClayPrompts (Connect to Claude or ChatGPT in the account menu) and connect again to allow saving."),
    isError: true,
  });

  server.registerTool(
    "start_saving",
    {
      title: "Save something to the library",
      description:
        "Call this first whenever the person wants to turn something into a prompt or skill: \"save this as a prompt\", \"make this a skill for the team\", \"add this to ClayPrompts\", or at the end of a session that went well. Returns the step-by-step walkthrough plus the exact app and team names to use. Saves nothing.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => text(savingGuide(await library())),
  );

  server.registerTool(
    "preview_item",
    {
      title: "Preview a new prompt or skill",
      description:
        "Check a draft before saving: validates it with the library's rules, fixes app/team name casing, flags problems (missing description, leftover specifics without {{placeholders}}, SKILL.md without frontmatter) and lists similar items that already exist. Saves nothing. Show the result to the person and get their OK before create_item.",
      inputSchema: itemShape,
      annotations: readOnly,
    },
    async (input) => {
      const l = await library();
      const p = prepare(l, input);
      return p.ok ? text(`${previewText(p)}\n\nNot saved yet. Ask the person to confirm, then call create_item with the same fields.`) : { ...text(previewText(p)), isError: true };
    },
  );

  server.registerTool(
    "create_item",
    {
      title: "Save a new prompt or skill",
      description:
        "Saves a new prompt or skill to the Clay prompt library, owned by the connected person. Only call after start_saving and preview_item, and only once the person has explicitly approved the preview, including public vs private (“my library” means private). With forked_from it saves their own version of an existing item. Returns the item's link. To change an existing item use preview_changes and update_item; deleting happens on the site.",
      inputSchema: itemShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (!canWrite) return reconnect();
      const l = await library();
      const p = prepare(l, input);
      if (!p.ok) return { ...text(previewText(p)), isError: true };
      const saved = await saveItem(service, l, p);
      const url = `${l.origin}/prompts/${saved.id}`;
      const d = p.draft!;
      return text(
        saved.duplicate
          ? `You already saved "${d.title}" a few minutes ago, so nothing new was created: ${url}`
          : `Saved "${d.title}" as a ${d.visibility} ${d.kind}: ${url}${p.warnings.length ? `\n\nSaved with these notes (fix them on the site if needed):\n${p.warnings.map((w) => `- ${w}`).join("\n")}` : ""}\n\nShare the link. They can open it to review it, add links or binary files, invite editors, or change anything; ${d.visibility === "public" ? "it shows up in search and next week's Slack digest" : "only they and editors can see it until they make it public"}.`,
      );
    },
  );

  server.registerTool(
    "preview_changes",
    {
      title: "Preview changes to a prompt or skill",
      description:
        "Check an edit to an existing item before saving it: pass the id and only the fields that change (body is the full new text, not a diff; apps, teams and links replace the whole list; skill files are added or replaced by name). Returns what would change, problems to fix, and a based_on value. Only the owner and editors can edit; only the owner can remove editors. Saves nothing. Show the result to the person and get their OK before update_item.",
      inputSchema: editShape,
      annotations: readOnly,
    },
    async (input) => {
      const l = await library();
      const p = prepareEdit(l, input);
      const body = editPreviewText(l, p);
      if (!p.ok) return { ...text(body), isError: true };
      return text(p.changes.length ? `${body}\n\nNot saved yet. Ask the person to confirm, then call update_item with the same fields and based_on.` : body);
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Save changes to a prompt or skill",
      description:
        "Saves an edit to an existing prompt or skill the person owns or edits. Only call after preview_changes, once the person has explicitly approved the changes; pass the same fields plus based_on from the preview. The previous version is kept in the item's version history.",
      inputSchema: editShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      if (!canWrite) return reconnect();
      const l = await library();
      const p = prepareEdit(l, input);
      if (!p.ok) return { ...text(editPreviewText(l, p)), isError: true };
      if (!p.changes.length) return text(editPreviewText(l, p));
      const saved = await saveEdit(service, l, p, input.based_on);
      if (!saved.ok) return { ...text(`Not saved: ${saved.error}`), isError: true };
      return text(`Saved changes to "${p.draft!.title}": ${l.origin}/prompts/${p.item!.id}\n${p.changes.map((c) => `- ${c}`).join("\n")}${p.warnings.length ? `\n\nNotes:\n${p.warnings.map((w) => `- ${w}`).join("\n")}` : ""}\n\nThe previous version is in its version history on the site if they want it back.`);
    },
  );

  // ── ChatGPT compatibility (deep research / company knowledge) ────────
  // OpenAI's documented shapes: search(query) → { results: [{ id, title, url }] },
  // fetch(id) → { id, title, text, url, metadata }, as structuredContent and as JSON text.
  server.registerTool(
    "search",
    {
      title: "Search (ids for fetch)",
      description: "Search the Clay prompt library and return ids, titles and links for fetch. In chat, search_library gives richer results.",
      inputSchema: { query: z.string().describe("What to look for") },
      outputSchema: { results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })) },
      annotations: readOnly,
    },
    async ({ query }) => {
      const l = await library();
      const results = search(l, query, {}, 10).map((h) => ({ id: h.item.id, title: h.item.title, url: itemUrl(l, h.item) }));
      const out = { results };
      return { structuredContent: out, content: [{ type: "text" as const, text: JSON.stringify(out) }] };
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch an item",
      description: "Full content of a prompt or skill by id (from search).",
      inputSchema: { id: z.string().describe("Item id from search") },
      outputSchema: { id: z.string(), title: z.string(), text: z.string(), url: z.string(), metadata: z.record(z.string(), z.string()).optional() },
      annotations: readOnly,
    },
    async ({ id }) => {
      const l = await library();
      const p = findItem(l, id);
      if (!p) return { ...text(`No item with id ${id} that you can see.`), isError: true };
      const out = {
        id: p.id,
        title: p.title,
        text: p.kind === "skill" ? skillText(l, p) : promptText(l, p),
        url: itemUrl(l, p),
        metadata: { kind: p.kind, apps: p.apps.map((a) => a.app).join(", "), teams: p.audiences.join(", "), owner: p.owner.name, updated: p.updatedAt.slice(0, 10) },
      };
      return { structuredContent: out, content: [{ type: "text" as const, text: JSON.stringify(out) }] };
    },
  );

  server.registerPrompt(
    "what_am_i_missing",
    {
      title: "What prompts and skills am I missing out on?",
      description: "Recommendations from the Clay prompt library based on what Claude knows about you.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `What prompts and skills from the Clay prompt library am I missing out on?

Use what you know about me from memory and our past conversations: my role and team, the work I do again and again, the tools I use, what I'm working toward and what slows me down. Keep it to work-relevant facts. If you know very little about me, ask me up to three quick questions first.

Then call recommend_for_me with that profile. Present the picks grouped by the part of my work they help with, one line each on why it fits me specifically, with its link. Point out any gaps nothing in the library covers yet. Finally, offer to run one of the prompts right now (run_prompt) or install one of the skills (install_skill).`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "find_for_task",
    {
      title: "Find a prompt or skill for a task",
      description: "Search the library for the best prompt or skill for something you're about to do.",
      argsSchema: { task: z.string().describe("What you're trying to do") },
    },
    ({ task }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Find the best prompt or skill in the Clay prompt library for this: ${task}

Call search_library and pick the one or two that genuinely fit (say so if nothing does); Enablement approved items first when they fit. Then help me use the best one now: for a prompt, call run_prompt, fill what you can from what you know, ask me for the rest, and run it here; for a skill, call install_skill for where I work.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "save_this_session",
    {
      title: "Save this as a prompt or skill",
      description: "Turn what worked in this conversation into a reusable prompt or skill in the Clay prompt library.",
      argsSchema: { idea: z.string().optional().describe("Optional: what to save, e.g. \"the call prep format we landed on\"") },
    },
    ({ idea }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `This session went well. Help me save ${idea ? `"${idea}"` : "what worked here"} to the Clay prompt library as a prompt or skill.

Call start_saving and follow its steps: draft a generalised version with {{placeholders}} for this session's specifics, propose a title, description, apps, teams and public/private for me to confirm in one go, show me preview_item, and only call create_item once I say yes.`,
          },
        },
      ],
    }),
  );

  const ask = (t: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }] });

  server.registerPrompt(
    "pull_my_prompt",
    {
      title: "Pull one of my prompts",
      description: "Find a prompt or skill in your own library (private ones included) and use it here.",
      argsSchema: { what: z.string().describe("What it does, e.g. \"QBR prep\"") },
    },
    ({ what }) =>
      ask(`Pull my prompt for ${what} from my Clay prompt library.

Call search_library with mine: true (my own items, private ones included). If one clearly fits, open it and offer to run it here with run_prompt (or install it with install_skill if it's a skill). If several could fit, list them in one line each and ask which. If none of mine fit, say so and search the whole library instead.`),
  );

  server.registerPrompt(
    "improve_from_this_chat",
    {
      title: "Improve a prompt from this chat",
      description: "Fold what worked in this conversation back into the library prompt or skill you used.",
      argsSchema: { item: z.string().optional().describe("Optional: the item's name or link, if it isn't obvious") },
    },
    ({ item }) =>
      ask(`Learn from this chat and revise ${item ? `"${item}"` : "the library prompt or skill we used"} so it works better next time.

Find the item (search_library with mine: true first if you need its id), call start_improving with it, and follow its steps: show me the improved version and what changed, then preview it and only save once I say yes.`),
  );

  server.registerPrompt(
    "compare_my_skills",
    {
      title: "Compare my Claude skills with the library",
      description: "Check the skills you already have in Claude against the Clay library: better versions, gaps, and ones worth sharing.",
    },
    () =>
      ask(`Compare the skills I already have installed in Claude with the Clay prompt library.

List the skills you can see in this conversation (names and one-line descriptions). For each, call search_library with kind skill to see if the library has the same or a better one, preferring Enablement approved items. Then give me three short lists: library skills that would replace or improve mine (with links, and install_skill when I want one), my skills the library doesn't have yet (offer to save them with start_saving), and library skills for my work I don't have at all. If you can't see my installed skills, ask me to name them.`),
  );

  return server;
}
