import type { DigestApp, DigestData, DigestMessage, SlackBlock } from "./types";

const MAX_NEW = 6;
const MAX_NOTES = 5;
const DESC_MAX = 140;

/** Escape the three characters Slack mrkdwn treats specially. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function link(url: string, label: string): string {
  return `<${url}|${esc(label)}>`;
}

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Truncate at a word boundary and add an ellipsis. */
export function clip(s: string, max = DESC_MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut.slice(0, max)).replace(/[,;:.]$/, "") + "…";
}

function kindLabel(kind: string): string {
  return kind === "skill" ? "Skill" : "Prompt";
}

function appsLabel(apps: DigestApp[]): string {
  return apps.map((a) => a.app).join(", ");
}

function joinNonZero(parts: [number, string, string?][]): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => plural(n, one, many))
    .join(" · ");
}

export interface BuildOptions {
  siteUrl: string; // https://www.clayprompts.com
  label: string; // "Sep 1 – 7"
  editorsNote?: string;
  authorHandle?: string; // "@cc"
  authorUrl?: string;
}

/** Turn a week's data into the Slack message described in the spec. */
export function buildDigestMessage(d: DigestData, o: BuildOptions): DigestMessage {
  const site = o.siteUrl.replace(/\/$/, "");
  const itemUrl = (id: string) => `${site}/prompts/${id}`;
  const blocks: SlackBlock[] = [];
  const fallback: string[] = [];

  // Header + stats line
  blocks.push({ type: "header", text: { type: "plain_text", text: `📬 Prompt library · ${o.label}`, emoji: true } });
  const stats = joinNonZero([
    [d.stats.new, "new this week", "new this week"],
    [d.stats.upvotes, "upvote"],
    [d.stats.forks, "fork"],
    [d.stats.feedback, "piece of feedback", "pieces of feedback"],
  ]);
  const statsLine = `${stats ? stats + " · " : ""}${plural(d.stats.total, "item")} in the library`;
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: statsLine }] });
  fallback.push(`Prompt library · ${o.label}: ${statsLine}.`);

  // Top this week
  blocks.push({ type: "divider" });
  if (d.top.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Top this week*" } });
    for (const t of d.top) {
      const meta = joinNonZero([
        [t.upvotes_week, "upvote"],
        [t.forks_week, "fork"],
        [t.feedback_week, "piece of feedback", "pieces of feedback"],
      ]);
      const by = t.owner_name ? `by ${esc(t.owner_name)}` : "";
      const line1 = `*${link(itemUrl(t.id), t.title)}* · ${kindLabel(t.kind)}${t.apps.length ? " · " + esc(appsLabel(t.apps)) : ""}`;
      const line2 = t.description ? esc(clip(t.description)) : "";
      const line3 = [meta ? `▲ ${meta}` : null, by].filter(Boolean).join(" · ");
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: [line1, line2, line3 ? `_${line3}_` : ""].filter(Boolean).join("\n") },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Open" },
          url: itemUrl(t.id),
          action_id: `open_${t.id.slice(0, 8)}`,
        },
      });
    }
    fallback.push(`Top: ${d.top.map((t) => t.title).join(", ")}.`);
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Top this week*\nA quiet week — nothing got upvoted or forked." },
    });
  }

  // New this week
  blocks.push({ type: "divider" });
  if (d.new_items.length) {
    const shown = d.new_items.slice(0, MAX_NEW);
    const lines = shown.map((n) => {
      const bits = [kindLabel(n.kind), n.apps.length ? esc(appsLabel(n.apps)) : null, n.owner_name ? esc(n.owner_name) : null].filter(Boolean);
      const fork = n.parent_title ? ` _(fork of ${esc(n.parent_title)})_` : "";
      return `• ${link(itemUrl(n.id), n.title)}${fork} · ${bits.join(" · ")}`;
    });
    const more = d.new_items.length - shown.length;
    if (more > 0) lines.push(`${link(`${site}/?sort=newest`, `+${more} more →`)}`);
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*New this week*\n${lines.join("\n")}` } });
    fallback.push(`New: ${shown.map((n) => n.title).join(", ")}${more > 0 ? ` and ${more} more` : ""}.`);
  } else {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*New this week*\nNothing new was added." } });
  }

  // Worth knowing (priority order, capped)
  const notes: string[] = [];
  const cat = d.catalog;
  if (cat.apps.length) notes.push(`*${cat.apps.map(esc).join("*, *")}* ${cat.apps.length === 1 ? "was" : "were"} added as ${cat.apps.length === 1 ? "an app" : "apps"} you can tag prompts with.`);
  if (cat.surfaces.length) notes.push(`New surface${cat.surfaces.length === 1 ? "" : "s"}: ${cat.surfaces.map(esc).join(", ")}.`);
  if (cat.teams.length) notes.push(`New team${cat.teams.length === 1 ? "" : "s"} in the Audience picker: ${cat.teams.map(esc).join(", ")}.`);
  for (const u of d.updated) {
    notes.push(`${link(itemUrl(u.id), u.title)} was updated ${u.versions === 2 ? "twice" : `${u.versions} times`} this week${u.last_editor ? ` (latest by ${esc(u.last_editor)})` : ""}.`);
  }
  if (d.stats.resolved || d.open_feedback_items.length) {
    const parts: string[] = [];
    if (d.stats.resolved) parts.push(`${plural(d.stats.resolved, "piece of feedback was", "pieces of feedback were")} resolved by owners.`);
    if (d.open_feedback_items.length) {
      const open = d.open_feedback_items.map((o) => `${link(itemUrl(o.id), o.title)}${o.open_count > 1 ? ` (${o.open_count})` : ""}`);
      parts.push(`${d.stats.open_feedback === 1 ? "1 is" : `${d.stats.open_feedback} are`} still open on ${open.join(" and ")}.`);
    }
    notes.push(parts.join(" "));
  }
  const note = (o.editorsNote ?? "").trim();
  const noteLines = notes.slice(0, note ? MAX_NOTES - 1 : MAX_NOTES);
  if (note) noteLines.push(`📝 _From the editors:_ ${esc(note)}`);
  if (noteLines.length) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Worth knowing*\n${noteLines.map((l) => `• ${l}`).join("\n")}` } });
  }

  // Footer
  blocks.push({ type: "divider" });
  const credit = o.authorHandle && o.authorUrl ? ` · Made by ${link(o.authorUrl, o.authorHandle)}` : "";
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Posted automatically by the ${link(site, "Prompt Library")} · ${link(`${site}/?sort=newest`, "Browse everything")}${credit}`,
      },
    ],
  });

  return { blocks, text: fallback.join(" ") };
}
