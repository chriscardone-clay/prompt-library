import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClayLogo } from "@/components/ClayLogo";
import { getCurrentUser } from "@/lib/data";
import { linkHost } from "@/lib/skills";
import { parseAuthorize } from "@/lib/mcp/oauth";
import { createServiceClient } from "@/lib/supabase/service";
import { decideAuthorization } from "../actions";
import styles from "../oauth.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an AI assistant" };

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"] as const;

/**
 * Consent screen for the MCP connector. The proxy has already sent signed-out
 * visitors through Google sign-in and back here with the same query string.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const f of FIELDS) {
    const v = raw[f];
    params[f] = Array.isArray(v) ? v[0] : v;
  }

  const parsed = await parseAuthorize(createServiceClient(), params);
  if (!parsed.ok && "redirect" in parsed) redirect(parsed.redirect);

  return (
    <main className={styles.page}>
      <div className={`slab-lg ${styles.card}`}>
        <ClayLogo className={styles.logo} />
        {parsed.ok ? (
          <>
            <div className="stack gap-2">
              <div className="eyebrow">Prompt library connector</div>
              <h1 className="display-sm">
                Let {parsed.req.client.name || "this app"} use the prompt library as you?
              </h1>
            </div>
            <ul className={styles.list}>
              <li>Search and read every public prompt and skill, plus private ones you own or edit.</li>
              <li>See your favorites and what you've created, to recommend what you're missing.</li>
              <li>Save new prompts and skills under your name, and edit ones you own or edit, when you ask it to. It shows you a preview first.</li>
              <li>It can't delete or upvote anything, or change items that aren't yours.</li>
            </ul>
            <div className="small muted">
              Signed in as <strong>{user.email}</strong>. You'll return to <strong>{linkHost(parsed.req.redirectUri)}</strong>. You can
              disconnect any time from Connect to Claude or ChatGPT in your account menu.
            </div>
            <form action={decideAuthorization} className={styles.actions}>
              {FIELDS.map((f) => (params[f] ? <input key={f} type="hidden" name={f} value={params[f]} /> : null))}
              <button type="submit" name="decision" value="deny" className="btn btn-outline btn-lg">
                Cancel
              </button>
              <button type="submit" name="decision" value="allow" className="btn btn-primary btn-lg">
                Allow
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="display-sm">This connection can't continue</h1>
            <div className="muted">{parsed.show}</div>
          </>
        )}
      </div>
    </main>
  );
}
