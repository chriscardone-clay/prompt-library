"use server";

import { z } from "zod";
import { askLibraryAi, MAX_TURN_CHARS, type Turn } from "@/lib/aiSearch";
import type { Kind } from "@/lib/constants";
import { aiSearchEnabled, getCatalog, getCurrentUser, getPrompt, listPrompts } from "@/lib/data";
import type { ActionResult } from "@/lib/draft";
import { createClient } from "@/lib/supabase/server";
import type { Approval, Profile, Prompt } from "@/lib/types";

/** Questions per chat. Only the most recent turns go to the model, so this just bounds storage. */
const MAX_QUESTIONS = 25;
const HISTORY = 30;

export interface AiCard {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  apps: string[];
  approval: Approval;
  mine: boolean;
  favorite: boolean;
  why: string;
}

export interface AiAnswer {
  reply: string;
  cards: AiCard[];
  followUps: string[];
  fallback: boolean;
}

export type AiEntry = { role: "user"; text: string; viewing?: { id: string; title: string } } | { role: "assistant"; answer: AiAnswer };

export interface AiChat {
  id: string;
  title: string;
  entries: AiEntry[];
  canAsk: boolean;
}

export interface AiChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** What's stored per turn. Picks keep only ids and reasons; cards are rebuilt on read. */
const StoredTurn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  /** User turns: the item they had open when they asked. */
  viewing: z.object({ id: z.string(), title: z.string() }).optional(),
  picks: z.array(z.object({ id: z.string(), why: z.string() })).optional(),
  followUps: z.array(z.string()).optional(),
  fallback: z.boolean().optional(),
  /** The model error behind a fallback, for debugging; never sent to the browser. */
  error: z.string().optional(),
});
type StoredTurn = z.infer<typeof StoredTurn>;

const AskInput = z.object({
  chatId: z.string().uuid().nullable(),
  /** The item the person has open, if any; access is re-checked here. */
  pageId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(1, "Ask something first.").max(MAX_TURN_CHARS, `Keep it under ${MAX_TURN_CHARS} characters.`),
});

async function gate(): Promise<{ user: Profile } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in again to ask." };
  if (!(await aiSearchEnabled())) return { error: "Ask AI isn't on for your account yet." };
  return { user };
}

function toCard(p: Prompt, user: Profile, why: string): AiCard {
  const email = user.email.toLowerCase();
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    description: p.description,
    apps: p.apps.map((a) => a.app),
    approval: p.approval,
    mine: p.ownerId === user.id || p.editors.some((e) => e.id === user.id || e.email.toLowerCase() === email),
    favorite: p.favoritedBy.includes(user.id),
    why,
  };
}

/** Stored turns → what the panel shows. Picks the person can no longer see drop out. */
function toEntries(turns: StoredTurn[], items: Prompt[], user: Profile): AiEntry[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  return turns.map((t) =>
    t.role === "user"
      ? { role: "user", text: t.text, viewing: t.viewing }
      : {
          role: "assistant",
          answer: {
            reply: t.text,
            cards: (t.picks ?? []).flatMap((pk) => (byId.has(pk.id) ? [toCard(byId.get(pk.id)!, user, pk.why)] : [])),
            followUps: t.followUps ?? [],
            fallback: !!t.fallback,
          },
        },
  );
}

function parseTurns(raw: unknown): StoredTurn[] {
  const r = z.array(StoredTurn).safeParse(raw);
  return r.success ? r.data : [];
}

/**
 * Ask AI: one question in a chat (a new one when chatId is null). The chat is
 * read and written as the person (RLS: only their own rows), and the library
 * is read as them, so it covers exactly what they can see, with workflows
 * only when their Workflows flag is on.
 */
export async function askLibrary(input: { chatId: string | null; question: string; pageId?: string | null }): Promise<ActionResult<{ chatId: string; title: string; answer: AiAnswer; canAsk: boolean }>> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const { user } = g;
  const parsed = AskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That question couldn't be sent." };
  const { chatId, question, pageId } = parsed.data;

  const supabase = await createClient();
  let turns: StoredTurn[] = [];
  if (chatId) {
    const { data, error } = await supabase.from("ai_chats").select("turns").eq("id", chatId).maybeSingle();
    if (error || !data) return { ok: false, error: "That chat isn't available any more. Start a new one." };
    turns = parseTurns(data.turns);
  }
  if (turns.filter((t) => t.role === "user").length >= MAX_QUESTIONS) return { ok: false, error: "This chat is full. Start a new one to keep going." };

  // getPrompt reads as the person (RLS) and hides workflows without the flag, so a page they can't see adds nothing.
  const [items, catalog, viewing] = await Promise.all([listPrompts(), getCatalog(), pageId ? getPrompt(pageId).catch(() => null) : Promise.resolve(null)]);
  const asked: StoredTurn[] = [...turns, { role: "user", text: question, ...(viewing ? { viewing: { id: viewing.id, title: viewing.title } } : {}) }];
  const forModel: Turn[] = asked.map((t) => ({ role: t.role, text: t.text || "(no reply)", picks: t.picks?.map((p) => p.id), viewing: t.viewing?.title }));
  const result = await askLibraryAi(items, user, forModel, catalog.apps.map((a) => a.name), undefined, viewing);
  const next: StoredTurn[] = [...asked, { role: "assistant", text: result.reply, picks: result.picks, followUps: result.followUps, fallback: result.fallback, ...(result.error ? { error: result.error } : {}) }];

  let id = chatId;
  let title = question.slice(0, 120);
  if (id) {
    const { data, error } = await supabase.from("ai_chats").update({ turns: next, updated_at: new Date().toISOString() }).eq("id", id).select("title").maybeSingle();
    if (error || !data) return { ok: false, error: "Couldn't save the chat. Try again." };
    title = data.title;
  } else {
    const { data, error } = await supabase.from("ai_chats").insert({ user_id: user.id, title, turns: next }).select("id").single();
    if (error || !data) return { ok: false, error: "Couldn't save the chat. Try again." };
    id = data.id as string;
  }

  const byId = new Map(items.map((p) => [p.id, p]));
  const answer: AiAnswer = {
    reply: result.reply,
    cards: result.picks.flatMap((pk) => (byId.has(pk.id) ? [toCard(byId.get(pk.id)!, user, pk.why)] : [])),
    followUps: result.followUps,
    fallback: result.fallback,
  };
  return { ok: true, data: { chatId: id!, title, answer, canAsk: next.filter((t) => t.role === "user").length < MAX_QUESTIONS } };
}

/** The person's recent chats, newest first. */
export async function listChats(): Promise<ActionResult<AiChatSummary[]>> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(HISTORY);
  if (error) return { ok: false, error: "Couldn't load your chats." };
  return { ok: true, data: (data ?? []).map((r) => ({ id: r.id as string, title: (r.title as string) || "Untitled chat", updatedAt: r.updated_at as string })) };
}

/** Reopen a chat to read or continue it. */
export async function openChat(id: string): Promise<ActionResult<AiChat>> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "That chat isn't available." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_chats").select("id, title, turns").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: "That chat isn't available any more." };
  const turns = parseTurns(data.turns);
  const items = await listPrompts();
  return { ok: true, data: { id: data.id as string, title: data.title as string, entries: toEntries(turns, items, g.user), canAsk: turns.filter((t) => t.role === "user").length < MAX_QUESTIONS } };
}

export async function deleteChat(id: string): Promise<ActionResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "That chat isn't available." };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_chats").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete that chat." };
  return { ok: true, data: undefined };
}
