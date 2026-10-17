import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { activeApps, activeTeams } from "@/lib/catalog";
import { fillBody, parsePlaceholders } from "@/lib/placeholders";
import { skillMd, skillSlug } from "@/lib/skills";
import { browse, findItem, installNotes, type Library, loadLibrary, search, skillFiles, summarize } from "./library";
import type { McpUser } from "./oauth";
import { recommend } from "./recommend";

const INSTRUCTIONS = `Clay's internal prompt library (ClayPrompts): prompts (text you paste into Town, Claude, ChatGPT, Claygent, Monty, Granola…) and skills (bundles of SKILL.md plus reference files you install into a tool), written and upvoted by people at Clay.

- To find something for a task, call search_library with the task in plain words; use browse_library to list by app, team or popularity.
- Before using an item, fetch it: get_prompt returns the full prompt text (with {{fill-ins}} filled when you pass values); get_skill returns the skill's files and how to install it.
- When the person asks what they're missing, what they should be using, or for recommendations, call recommend_for_me with a profile built from what you know about them (memory, past conversations, this chat). Use the what_am_i_missing prompt's guidance.
- Always give the item's link so they can open, upvote or fork it. Never invent items; only recommend what the tools return.`;

const kind = z.enum(["prompt", "skill"]).optional().describe("Only prompts or only skills");
const app = z.string().optional().describe("Only items built for this app, e.g. Claude, Town, ChatGPT, Claygent, Granola");
const team = z.string().optional().describe("Only items for this team, e.g. GTM, Sales, CS");

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
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
        "Ranked search over prompts and skills by what they do. Pass the task in plain words (\"recap a customer call for Slack\", \"Clay formula to score accounts\"). Returns compact cards with ids; fetch one with get_prompt or get_skill before using it.",
      inputSchema: { query: z.string().min(1).describe("What the person wants to do"), kind, app, team, limit: z.number().int().min(1).max(20).optional() },
      annotations: readOnly,
    },
    async ({ query, kind, app, team, limit }) => {
      const l = await library();
      const hits = search(l, query, { kind, app, team }, limit ?? 8);
      if (!hits.length) {
        return text(
          `Nothing in the library matches "${query}"${kind || app || team ? " with those filters" : ""}. Try fewer words or no filters, or browse_library. If the person writes one that works, they can add it at ${l.origin}/prompts/new so the next person finds it.`,
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
      description: "List prompts and skills, optionally filtered by kind, app or team, sorted by top (most upvoted/favorited), new, or updated. Use search_library when you have a task in mind.",
      inputSchema: {
        kind,
        app,
        team,
        sort: z.enum(["top", "new", "updated"]).optional().describe("Default: top"),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: readOnly,
    },
    async ({ kind, app, team, sort, limit, offset }) => {
      const l = await library();
      const n = limit ?? 15;
      const from = offset ?? 0;
      const { total, page } = browse(l, { kind, app, team }, sort ?? "top", n, from);
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
      const body = p.kind === "skill" ? skillMd(p.files) || p.body : p.body;
      const keys = p.kind === "prompt" ? parsePlaceholders(body) : [];
      const filled = values && keys.length ? fillBody(body, values) : body;
      const missing = keys.filter((k) => !values?.[k]?.trim());
      const out = [
        summarize(l, p),
        p.notes ? `\n## How to use\n${p.notes}` : "",
        p.links.length ? `\n## Where it's saved\n${p.links.map((x) => `- ${x.label || x.url}: ${x.url}`).join("\n")}` : "",
        keys.length ? `\n## Fill-ins\n${keys.map((k) => `- ${k}${values?.[k]?.trim() ? ` = ${values[k]}` : " (not filled)"}`).join("\n")}` : "",
        `\n## ${p.kind === "skill" ? "SKILL.md" : values && keys.length ? "Prompt (filled)" : "Prompt"}\n\n${filled || "(This item is link-only; open it where it's saved.)"}`,
        missing.length && values ? `\nStill unfilled: ${missing.join(", ")}. Ask the person for these or fill them from context.` : "",
      ];
      return text(out.filter(Boolean).join("\n"));
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
      const files = skillFiles(p);
      const install = installNotes(l, p);
      const out = [
        summarize(l, p),
        p.notes ? `\n## How to use\n${p.notes}` : "",
        p.links.length ? `\n## Open it where it lives\n${p.links.map((x) => `- ${x.label || x.url}: ${x.url}`).join("\n")}` : "",
        install.length ? `\n## Install\n${install.join("\n")}\n- Or download the .skill bundle from ${l.origin}/prompts/${p.id}` : `\n## Install\nDownload the .skill bundle from ${l.origin}/prompts/${p.id}`,
        `\nFolder name: ${skillSlug(p.title, p.files)}`,
        ...files.text.map((f) => `\n## File: ${f.name}${f.truncated ? " (truncated)" : ""}\n\n\`\`\`\`\n${f.content}\n\`\`\`\``),
        files.binary.length ? `\nBinary files (in the .skill download only): ${files.binary.join(", ")}` : "",
        files.omitted.length ? `\nNot shown (size limit; in the .skill download): ${files.omitted.join(", ")}` : "",
        !p.files.length && !p.links.length ? "\nThis skill has no files or links." : "",
      ];
      return text(out.filter(Boolean).join("\n"));
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
    "my_library",
    {
      title: "My favorites and creations",
      description: "Items the person created, edits, or saved to favorites on ClayPrompts.",
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

Then call recommend_for_me with that profile. Present the picks grouped by the part of my work they help with, one line each on why it fits me specifically, with its link. Point out any gaps nothing in the library covers yet. Finally, offer to open any of them (get_prompt / get_skill) so I can try one right now.`,
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

Call search_library, pick the one or two that genuinely fit (say so if nothing does), fetch the best one with get_prompt or get_skill, and help me use it now: fill in any {{fill-ins}} from what you know or ask me for them.`,
          },
        },
      ],
    }),
  );

  return server;
}
