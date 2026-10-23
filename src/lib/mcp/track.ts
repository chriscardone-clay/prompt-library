import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { McpUser } from "./oauth";

/**
 * Connector usage, one connector_events row per tool call (see
 * supabase/migrations/0027_outdated_and_connector_events.sql). Written after
 * the response so it never slows a call down, and best effort: a failed
 * write is logged, never surfaced.
 *
 * Never record fill-in values or the recommend_for_me profile: they can hold
 * customer data, and the tool descriptions promise the profile isn't stored.
 * Record which fill-ins were given and counts instead.
 */

export type Action = "search" | "browse" | "view" | "run" | "install" | "recommend" | "improve" | "save" | "edit" | "review" | "report" | "other";
export type Outcome = "ok" | "empty" | "needs_input" | "denied" | "not_found" | "error";

/** What a tool fills in about its call. Everything is optional; unset fields keep their defaults. */
export interface Event {
  promptId?: string | null;
  query?: string;
  filters?: Record<string, unknown>;
  resultIds?: string[];
  resultCount?: number;
  outcome?: Outcome;
  detail?: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (xs: string[] | undefined) => (xs ?? []).filter((x) => UUID.test(x)).slice(0, 50);
const compact = (o: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));

type Result = { content: unknown; isError?: boolean };

export function tracker(service: SupabaseClient, me: McpUser) {
  let clientName: Promise<string> | null = null;
  const name = () =>
    (clientName ??= Promise.resolve(
      service
        .from("mcp_clients")
        .select("client_name")
        .eq("client_id", me.clientId)
        .maybeSingle()
        .then(({ data }) => ((data as { client_name: string } | null)?.client_name ?? "").slice(0, 200)),
    ).catch(() => ""));

  function write(tool: string, action: Action, ev: Event, ms: number) {
    after(async () => {
      const { error } = await service.from("connector_events").insert({
        user_id: me.id,
        client_id: me.clientId,
        client_name: await name(),
        tool,
        action,
        prompt_id: ev.promptId && UUID.test(ev.promptId) ? ev.promptId : null,
        query: ev.query ? ev.query.slice(0, 500) : null,
        filters: compact(ev.filters),
        result_ids: ids(ev.resultIds),
        result_count: ev.resultCount ?? null,
        outcome: ev.outcome ?? "ok",
        detail: compact(ev.detail),
        duration_ms: Math.round(ms),
      });
      if (error) console.warn(`[mcp] event not recorded (${tool}):`, error.message);
    });
  }

  /**
   * Wrap a tool handler so its call is recorded. The handler gets an Event to
   * fill in; an isError result without an outcome counts as "error", and a
   * thrown error is recorded and rethrown.
   */
  return function traced<A, R extends Result>(tool: string, action: Action, fn: (args: A, ev: Event) => Promise<R>): (args: A) => Promise<R> {
    return async (args: A) => {
      const ev: Event = {};
      const t0 = performance.now();
      try {
        const res = await fn(args, ev);
        if (res.isError && !ev.outcome) ev.outcome = "error";
        write(tool, action, ev, performance.now() - t0);
        return res;
      } catch (err) {
        write(tool, action, { ...ev, outcome: "error", detail: { ...ev.detail, error: err instanceof Error ? err.message.slice(0, 300) : "unknown" } }, performance.now() - t0);
        throw err;
      }
    };
  };
}

export type Traced = ReturnType<typeof tracker>;
