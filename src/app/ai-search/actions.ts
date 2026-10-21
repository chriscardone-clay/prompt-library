"use server";

import { z } from "zod";
import { askLibraryAi, MAX_TURN_CHARS, MAX_TURNS } from "@/lib/aiSearch";
import { aiSearchEnabled, getCatalog, getCurrentUser, listPrompts } from "@/lib/data";
import type { ActionResult } from "@/lib/draft";
import type { Kind } from "@/lib/constants";
import type { Approval } from "@/lib/types";

const TurnsSchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1).max(MAX_TURN_CHARS),
      picks: z.array(z.string().max(64)).max(10).optional(),
    }),
  )
  .min(1)
  .max(MAX_TURNS)
  .refine((t) => t[t.length - 1].role === "user", "The last turn must be the person's question.");

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
  searched: number;
}

/**
 * Ask AI: one turn of the conversation. The whole conversation comes from the
 * browser each time (nothing is stored); the library is read as the person,
 * so it covers exactly what they can see, with workflows only when their
 * Workflows flag is on.
 */
export async function askLibrary(turns: unknown): Promise<ActionResult<AiAnswer>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to ask." };
  if (!(await aiSearchEnabled())) return { ok: false, error: "Ask AI isn't on for your account yet." };
  const parsed = TurnsSchema.safeParse(turns);
  if (!parsed.success) return { ok: false, error: `Keep questions under ${MAX_TURN_CHARS} characters, and start a new search after ${MAX_TURNS / 2} questions.` };

  const [items, catalog] = await Promise.all([listPrompts(), getCatalog()]);
  const result = await askLibraryAi(items, user, parsed.data, catalog.apps.map((a) => a.name));
  const byId = new Map(items.map((p) => [p.id, p]));
  const email = user.email.toLowerCase();
  const cards = result.picks.flatMap((pick) => {
    const p = byId.get(pick.id);
    if (!p) return [];
    return [
      {
        id: p.id,
        kind: p.kind,
        title: p.title,
        description: p.description,
        apps: p.apps.map((a) => a.app),
        approval: p.approval,
        mine: p.ownerId === user.id || p.editors.some((e) => e.id === user.id || e.email.toLowerCase() === email),
        favorite: p.favoritedBy.includes(user.id),
        why: pick.why,
      },
    ];
  });
  return { ok: true, data: { reply: result.reply, cards, followUps: result.followUps, fallback: result.fallback, searched: result.searched } };
}
