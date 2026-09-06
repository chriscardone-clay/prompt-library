/**
 * Turning a natural-language ask into something Postgres full-text search can
 * rank well. Pure functions; safe to use on the server or in tests.
 */

/** Words that carry no signal about *what* someone wants. */
const FILLER = new Set(
  (
    "a an the is are was were be been do does did we you i im i'm ive i've my our your me us it its this that these those there here " +
    "have has had any anything something some someone anyone one ones thing things stuff " +
    "to for of in on at by from with about into over as vs versus " +
    "and or but so if then than also just only really very kind kinda sort sorta like " +
    "can could would should will shall may might want wants wanted need needs needed looking look find finding search searching " +
    "help helps helping please pls thanks thank hey hi hello yo ok okay " +
    "how what whats what's which who where when why " +
    "prompt prompts skill skills library clayprompts template templates example examples " +
    "give show get got let lets let's know exists exist available got have " +
    "new make made making use using used run running many much more most before after first last up down out " +
    "good best great nice quick easy fast way ways tool tools thing things anyone somebody everybody " +
    "doing done did go going gonna wanna try trying"
  ).split(/\s+/),
);

/** Lightweight synonym expansion: key → extra words worth searching for. */
const SYNONYMS: Record<string, string[]> = {
  recap: ["summary", "summarize", "notes"],
  recaps: ["summary", "summarize", "notes"],
  summary: ["recap", "summarize"],
  summarize: ["recap", "summary"],
  summarise: ["recap", "summary"],
  notes: ["recap", "summary"],
  call: ["meeting"],
  calls: ["meeting"],
  meeting: ["call"],
  meetings: ["call", "calendar"],
  transcript: ["meeting", "recap"],
  transcripts: ["meeting", "recap"],
  email: ["gmail", "inbox", "mail"],
  emails: ["gmail", "inbox", "mail"],
  inbox: ["email", "gmail"],
  gmail: ["email", "inbox"],
  formula: ["formulas", "javascript", "expression"],
  formulas: ["formula", "javascript", "expression"],
  chart: ["graph", "visualization", "png"],
  charts: ["graph", "visualization", "png"],
  graph: ["chart", "visualization"],
  visualization: ["chart", "graph"],
  visualize: ["chart", "graph"],
  plot: ["chart", "graph"],
  research: ["prep", "brief", "lookup"],
  prep: ["preparation", "research", "brief"],
  prepare: ["preparation", "research", "brief"],
  preparation: ["prep", "research"],
  brief: ["research", "prep", "handoff"],
  account: ["customer", "company"],
  accounts: ["customer", "company", "opportunities"],
  customer: ["account", "client"],
  customers: ["account", "client"],
  client: ["customer", "account"],
  company: ["account", "customer"],
  prospect: ["account", "company", "research"],
  slack: ["message", "channel"],
  message: ["slack"],
  handoff: ["handover", "brief", "closed", "deal"],
  handover: ["handoff", "brief"],
  audit: ["usage", "credits", "utilization"],
  credits: ["usage", "audit", "utilization"],
  usage: ["audit", "credits", "utilization"],
  calendar: ["week", "meetings", "schedule"],
  schedule: ["calendar", "week"],
  week: ["calendar", "weekly"],
  todo: ["action", "items", "decisions"],
  todos: ["action", "items", "decisions"],
  actions: ["action", "items", "decisions"],
  decisions: ["action", "items"],
  slow: ["performance", "duration"],
  performance: ["slow", "duration"],
  latency: ["performance", "duration"],
  agent: ["claygent"],
  claygent: ["agent", "research"],
  outreach: ["email", "message"],
  followup: ["follow-up", "email", "recap"],
  "follow-up": ["followup", "email", "recap"],
  followups: ["follow-up", "email"],
  pipeline: ["opportunities", "accounts"],
  deal: ["opportunity", "closed", "handoff"],
  deals: ["opportunities", "closed"],
  opportunity: ["deal", "opportunities"],
  opportunities: ["deals", "pipeline"],
  catch: ["summarize", "channel"],
  channel: ["slack"],
  data: ["table", "enrichment"],
  table: ["tables", "clay"],
  tables: ["table", "clay"],
  onsite: ["on-site", "meeting"],
  "on-site": ["onsite", "meeting"],
};

export interface Intent {
  /** Content words, in order, deduplicated. */
  words: string[];
  /** Synonym expansions (never overlap `words`). */
  extra: string[];
  /** The cleaned question as one string, for fuzzy title matching. */
  query: string;
  /** "skill" / "prompt" when the person said which they want. */
  kind: "prompt" | "skill" | null;
  /** Lower-cased app names the person mentioned (from the catalog). */
  apps: string[];
}

export function parseIntent(question: string, appNames: string[]): Intent {
  const lower = question.toLowerCase().replace(/[’`]/g, "'");
  const wantsSkill = /\bskills?\b/.test(lower);
  const wantsPrompt = /\bprompts?\b/.test(lower);
  const kind = wantsSkill && !wantsPrompt ? "skill" : wantsPrompt && !wantsSkill ? "prompt" : null;

  const apps = appNames.map((a) => a.toLowerCase()).filter((a) => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));

  const raw = lower
    .replace(/<[^>]+>/g, " ") // slack mentions / links
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w));

  const words: string[] = [];
  for (const w of raw) if (!words.includes(w)) words.push(w);

  const extra: string[] = [];
  for (const w of words) for (const s of SYNONYMS[w] ?? []) if (!words.includes(s) && !extra.includes(s)) extra.push(s);

  return { words, extra, query: words.join(" "), kind, apps };
}

/** Title-case the content words: a plausible name for the thing that's missing. */
export function suggestTitle(intent: Intent): string | undefined {
  const words = intent.words.filter((w) => !intent.apps.includes(w)).slice(0, 6);
  if (!words.length) return undefined;
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return `${title} ${intent.kind === "skill" ? "skill" : "prompt"}`;
}
