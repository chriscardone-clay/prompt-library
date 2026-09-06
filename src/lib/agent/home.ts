import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SLACK_CHANNEL_NAME, SLACK_CHANNEL_URL } from "@/lib/constants";
import { clip, esc } from "@/lib/digest/blocks";
import { getSiteUrl } from "@/lib/site";

/** Starter questions for the assistant pane and the Home tab. */
export const SUGGESTED_PROMPTS = [
  { title: "Recap a customer call", message: "Something to recap a customer call for Slack" },
  { title: "Clay formulas", message: "Is there a skill for writing Clay formulas?" },
  { title: "Prep for a meeting", message: "Research an account before a first meeting" },
  { title: "What's new?", message: "What was added to the library this week?" },
];

interface Item {
  id: string;
  title: string;
  description: string | null;
  kind: string | null;
  created_at: string;
  owner: { name: string } | null;
  prompt_apps: { app: string }[] | null;
  prompt_upvotes: { user_id: string }[] | null;
}

const SELECT = "id, title, description, kind, created_at, owner:profiles!prompts_owner_id_fkey ( name ), prompt_apps ( app ), prompt_upvotes ( user_id )";

function line(site: string, it: Item, extra?: string): string {
  const kind = it.kind === "skill" ? "Skill" : "Prompt";
  const apps = (it.prompt_apps ?? []).map((a) => a.app).join(", ");
  const bits = [kind, apps || null, extra ?? null].filter(Boolean).join(" · ");
  return `• *<${site}/prompts/${it.id}|${esc(it.title)}>* · ${bits}`;
}

/**
 * Blocks for the App Home tab: library at a glance, most upvoted, newest,
 * the person's own favorites (when we can map their Slack account to a profile),
 * and how to ask the assistant. Public items only.
 */
export async function buildHomeBlocks(client: SupabaseClient, email: string | null): Promise<Record<string, unknown>[]> {
  const site = getSiteUrl();
  const { data, error } = await client.from("prompts").select(SELECT).eq("visibility", "public");
  if (error) throw new Error(`home: ${error.message}`);
  const items = (data ?? []) as unknown as Item[];
  const total = items.length;
  const skills = items.filter((i) => i.kind === "skill").length;
  const weekAgo = Date.now() - 7 * 86400000;
  const newThisWeek = items.filter((i) => new Date(i.created_at).getTime() > weekAgo).length;

  const top = [...items]
    .filter((i) => (i.prompt_upvotes?.length ?? 0) > 0)
    .sort((a, b) => (b.prompt_upvotes?.length ?? 0) - (a.prompt_upvotes?.length ?? 0) || b.created_at.localeCompare(a.created_at))
    .slice(0, 5);
  const newest = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  let favorites: Item[] = [];
  let personName: string | null = null;
  if (email) {
    const { data: prof } = await client.from("profiles").select("id, name").eq("email", email).maybeSingle();
    const profile = prof as { id: string; name: string } | null;
    if (profile) {
      personName = profile.name;
      const { data: favs } = await client.from("prompt_favorites").select("prompt_id").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(6);
      const ids = new Set(((favs ?? []) as { prompt_id: string }[]).map((f) => f.prompt_id));
      favorites = items.filter((i) => ids.has(i.id));
    }
  }

  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: `📚 Clay Prompt Library${personName ? ` · hi ${personName.split(" ")[0]}` : ""}`, emoji: true } },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${total} items · ${skills} skills${newThisWeek ? ` · ${newThisWeek} new this week` : ""} · <${site}|Open the library> · <${SLACK_CHANNEL_URL}|${SLACK_CHANNEL_NAME}>`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Ask me for a prompt or skill*\nOpen the *Messages* tab (or the assistant pane) and describe the task. Try: _${SUGGESTED_PROMPTS.slice(0, 2)
          .map((p) => `“${p.message}”`)
          .join("_ or _")}_`,
      },
    },
  ];

  if (top.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Most upvoted*\n${top.map((it) => line(site, it, `▲ ${it.prompt_upvotes?.length ?? 0}`)).join("\n")}` },
    });
  }
  if (favorites.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Your favorites*\n${favorites.map((it) => line(site, it)).join("\n")}` },
      accessory: { type: "button", text: { type: "plain_text", text: "All favorites" }, url: `${site}/favorites`, action_id: "open_favorites" },
    });
  }
  if (newest.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Newest*\n${newest
          .map((it) => line(site, it, it.owner?.name ? esc(it.owner.name) : undefined))
          .join("\n")}`,
      },
      accessory: { type: "button", text: { type: "plain_text", text: "Browse newest" }, url: `${site}/?sort=new`, action_id: "open_newest" },
    });
    // Slightly clipped descriptions for the very newest one, as a teaser.
    const teaser = newest[0];
    if (teaser?.description) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Latest: *${esc(teaser.title)}* — ${esc(clip(teaser.description, 140))}` }] });
    }
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Open the library" }, url: site, style: "primary", action_id: "open_library" },
      { type: "button", text: { type: "plain_text", text: "Add a prompt" }, url: `${site}/prompts/new`, action_id: "open_new_prompt" },
      { type: "button", text: { type: "plain_text", text: "Add a skill" }, url: `${site}/skills/new`, action_id: "open_new_skill" },
    ],
  });
  return blocks;
}
