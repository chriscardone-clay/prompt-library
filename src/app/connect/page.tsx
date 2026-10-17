import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CopyField } from "@/components/CopyField";
import { Header } from "@/components/Header";
import { revokeGrant } from "@/app/oauth/actions";
import { getCurrentUser } from "@/lib/data";
import { getRequestOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import styles from "./connect.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect to Claude" };

interface GrantRow {
  id: string;
  created_at: string;
  last_used_at: string | null;
  client: { client_name: string } | null;
}

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";
}

/** How to add the MCP connector to Claude, and the person's connected apps. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ revoked?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { revoked, error } = await searchParams;
  const origin = await getRequestOrigin();
  const url = `${origin}/api/mcp`;

  const supabase = await createClient();
  const { data } = await supabase
    .from("mcp_grants")
    .select("id, created_at, last_used_at, client:mcp_clients ( client_name )")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const grants = (data ?? []) as unknown as GrantRow[];

  return (
    <div className="container">
      <Header user={user} />
      <main className={styles.main}>
        <div className="stack gap-2">
          <div className="eyebrow">Connector</div>
          <h1 className="display-md">Use the library from Claude</h1>
          <p className="muted">
            Connect once and ask Claude for prompts and skills in any chat: “find me a prompt for a QBR deck”, “install the Clay formulas skill”, or
            “what prompts and skills am I missing out on?”, which Claude answers from what it knows about your work.
          </p>
        </div>

        {revoked ? <div className={styles.notice}>Disconnected. That app can no longer read the library as you.</div> : null}
        {error ? <div className={styles.notice}>That connection request couldn't be verified. Remove the connector in Claude and add it again.</div> : null}

        <section className="slab">
          <h2 className="section-title">Connector URL</h2>
          <CopyField value={url} label="Connector URL" />
        </section>

        <section className={styles.grid}>
          <div className="slab">
            <h2 className="section-title">Claude (web, desktop, mobile)</h2>
            <ol className={styles.steps}>
              <li>
                In Claude, open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.
              </li>
              <li>
                Name it <strong>Clay prompt library</strong> and paste the URL above. Leave the OAuth fields empty.
              </li>
              <li>
                Click <strong>Connect</strong>, sign in with your @clay.com Google account, and allow access.
              </li>
              <li>In a chat, turn it on from the tools menu. Its prompts (like “What am I missing?”) appear under the + menu.</li>
            </ol>
            <div className="small muted">On Team and Enterprise plans an owner may need to add the connector for the organisation first.</div>
          </div>
          <div className="slab">
            <h2 className="section-title">Claude Code</h2>
            <CopyField value={`claude mcp add --transport http clayprompts ${url}`} label="Claude Code command" />
            <div className="small muted">
              Then run <code>/mcp</code> in Claude Code and choose <strong>Authenticate</strong>. Claude Code can also install skills straight into{" "}
              <code>~/.claude/skills</code> when you ask it to.
            </div>
          </div>
        </section>

        <section className="slab">
          <h2 className="section-title">What you can ask</h2>
          <ul className={styles.steps}>
            <li>“Is there a prompt for recapping a customer call into Slack?”</li>
            <li>“Get the account research prompt and fill it in for Acme.”</li>
            <li>“Show me the top skills for Claude this month.”</li>
            <li>“What prompts and skills am I missing out on?” Claude builds a picture of your role and recurring work from its memory, then recommends what you don't use yet.</li>
          </ul>
          <div className="small muted">
            The connector is read-only. For recommendations, Claude sends a short work profile it writes itself; the library uses it for that one answer and doesn't store it.
          </div>
        </section>

        <section className="slab">
          <h2 className="section-title">Connected apps</h2>
          {grants.length ? (
            <ul className={styles.grants}>
              {grants.map((g) => (
                <li key={g.id} className={styles.grant}>
                  <div className="stack">
                    <strong>{g.client?.client_name || "Unnamed app"}</strong>
                    <span className="small muted">
                      Connected {day(g.created_at)} · last used {day(g.last_used_at)}
                    </span>
                  </div>
                  <form action={revokeGrant}>
                    <input type="hidden" name="id" value={g.id} />
                    <button type="submit" className="btn btn-outline btn-sm">
                      Disconnect
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <div className="muted small">Nothing connected yet.</div>
          )}
        </section>
      </main>
    </div>
  );
}
