import { ArrowsClockwise, DownloadSimple, LockSimple, MagnifyingGlass, Play, SealCheck, Swap } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CopyField } from "@/components/CopyField";
import { Header } from "@/components/Header";
import { revokeGrant } from "@/app/oauth/actions";
import { enablementEnabled, getCurrentUser } from "@/lib/data";
import { getRequestOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import styles from "./connect.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Use the library in Claude, ChatGPT or Cursor" };

const LOOM = "https://www.loom.com/embed/73569a1e9c454c7b83f11233517d7244";

interface GrantRow {
  id: string;
  created_at: string;
  last_used_at: string | null;
  client: { client_name: string } | null;
}

interface UseCase {
  icon: ReactNode;
  title: string;
  ask: string;
  body: string;
}

function day(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";
}

/**
 * The connector's home: what it does (video and use cases), how to add it to
 * each app, and the person's connected apps.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ revoked?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { revoked, error } = await searchParams;
  const origin = await getRequestOrigin();
  const url = `${origin}/api/mcp`;
  const enablement = await enablementEnabled();

  const supabase = await createClient();
  const { data } = await supabase
    .from("mcp_grants")
    .select("id, created_at, last_used_at, client:mcp_clients ( client_name )")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const grants = (data ?? []) as unknown as GrantRow[];

  const uses: UseCase[] = [
    {
      icon: enablement ? <SealCheck weight="bold" size={18} /> : <MagnifyingGlass weight="bold" size={18} />,
      title: "Find the best fit",
      ask: "Find me a prompt for QBR prep.",
      body: enablement
        ? "Searches by what you're doing. Enablement approved prompts and skills come first, so you start from what's been proven to work."
        : "Searches by what you're doing, not by title, and links every result so you can open, upvote or fork it.",
    },
    {
      icon: <Play weight="bold" size={18} />,
      title: "Run it right in the chat",
      ask: "Run that prompt for Acme.",
      body: "It asks for the fill-ins it can't work out from the conversation, then runs the prompt in the same chat. No copying and pasting.",
    },
    {
      icon: <DownloadSimple weight="bold" size={18} />,
      title: "Install skills",
      ask: "Install the Clay formulas skill.",
      body: "If the skill is already published in Claude, you install it from there. Claude Code writes the files for you. Anywhere else you get a one-click .skill download.",
    },
    {
      icon: <LockSimple weight="bold" size={18} />,
      title: "Your own private library",
      ask: "Pull my prompt for discovery call prep.",
      body: "Searches only your items, private ones included. Say “save this to my library” mid-conversation and it's saved privately, under your name.",
    },
    {
      icon: <ArrowsClockwise weight="bold" size={18} />,
      title: "Learn from the chat",
      ask: "Learn from this chat and revise that prompt.",
      body: "Folds the corrections you made back into the prompt, so it works better next time. For someone else's prompt, it saves your own linked version.",
    },
    {
      icon: <Swap weight="bold" size={18} />,
      title: "Compare your skills",
      ask: "Compare my Claude skills with the library.",
      body: "Finds better versions of the skills you already have, what your team has that you don't, and which of yours are worth sharing.",
    },
  ];

  return (
    <div className="container">
      <Header user={user} active="connect" />
      <main className={styles.main}>
        <section className={styles.hero}>
          <div className="eyebrow">Connector · Claude, ChatGPT, Cursor</div>
          <h1 className="display-lg">Your prompt library, inside every chat</h1>
          <p className={styles.lede}>
            Connect once, then find the best prompt for the job, run it, install skills, and keep improving your own library without leaving the conversation.
            Think of it as a repository of what works: yours privately, and your team&apos;s when you share it.
          </p>
          <div className={styles.heroActions}>
            <a href="#setup" className="btn btn-primary">
              Set it up in 2 minutes
            </a>
            {grants.length ? (
              <span className={styles.status}>
                <span className={styles.dot} aria-hidden />
                Connected in {grants.length} app{grants.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </section>

        {revoked ? <div className={styles.notice}>Disconnected. That app can no longer read the library as you.</div> : null}
        {error ? <div className={styles.notice}>That connection request couldn&apos;t be verified. Remove the connector in Claude and add it again.</div> : null}

        <section className={styles.video} aria-label="Video walkthrough">
          <div className={styles.frame}>
            <iframe src={LOOM} title="ClayPrompts connector walkthrough" allow="fullscreen" allowFullScreen loading="lazy" />
          </div>
          <p className="small muted">
            A quick walkthrough. The idea: get better at AI while you&apos;re working with it. You learn from what works for your team, and your library
            gets better every time you use it.
          </p>
        </section>

        <section className="stack gap-2" aria-labelledby="uses">
          <h2 id="uses" className="display-sm">
            What you can do
          </h2>
          <ul className={styles.uses}>
            {uses.map((u) => (
              <li key={u.title} className={styles.use}>
                <div className={styles.useHead}>
                  <span className={styles.useIcon}>{u.icon}</span>
                  <h3 className={styles.useTitle}>{u.title}</h3>
                </div>
                <p className={styles.ask}>“{u.ask}”</p>
                <p className="small muted">{u.body}</p>
              </li>
            ))}
          </ul>
          <p className="small muted">
            It also speaks up when it helps: it points out a library prompt when you start a task one covers, and offers to save or improve one when a chat
            produces something worth keeping. Once per topic, not every message.
          </p>
        </section>

        <section id="setup" className={`stack gap-2 ${styles.setup}`} aria-labelledby="setup-title">
          <h2 id="setup-title" className="display-sm">
            Set it up
          </h2>
          <div className="slab">
            <h3 className="section-title">Connector URL</h3>
            <CopyField value={url} label="Connector URL" />
            <div className="small muted">Every app below signs you in with your @clay.com Google account. You never paste a key or password.</div>
          </div>

          <div className={styles.grid}>
            <div className="slab">
              <h3 className="section-title">Claude (web, desktop, mobile)</h3>
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
                <li>In a chat, turn it on from the tools menu. Its shortcuts (like “Pull my prompt”) appear under the + menu.</li>
              </ol>
              <div className="small muted">On Team and Enterprise plans an owner may need to add the connector for the organisation first.</div>
            </div>
            <div className="slab">
              <h3 className="section-title">ChatGPT</h3>
              <ol className={styles.steps}>
                <li>
                  In ChatGPT, open <strong>Settings → Apps &amp; Connectors → Advanced settings</strong> and turn on <strong>Developer mode</strong>.
                </li>
                <li>
                  Back in <strong>Apps &amp; Connectors</strong>, choose <strong>Create</strong>. Name it <strong>Clay prompt library</strong>, paste the URL
                  above, and pick <strong>OAuth</strong> for authentication.
                </li>
                <li>
                  Sign in with your @clay.com Google account and allow access, then click <strong>Create</strong>.
                </li>
                <li>
                  In a chat, open <strong>+ → More</strong> and pick the app. ChatGPT asks you to confirm before it saves anything.
                </li>
              </ol>
              <div className="small muted">
                Developer mode depends on your ChatGPT plan, and workspace admins may need to enable it. On some plans ChatGPT only allows read tools, so
                searching works but saving doesn&apos;t.
              </div>
            </div>
            <div className="slab">
              <h3 className="section-title">Claude Code</h3>
              <CopyField value={`claude mcp add --transport http clayprompts ${url}`} label="Claude Code command" />
              <div className="small muted">
                Then run <code>/mcp</code> and choose <strong>Authenticate</strong>. Ask it to install a skill and it writes the files into{" "}
                <code>~/.claude/skills</code> once you say yes.
              </div>
            </div>
            <div className="slab">
              <h3 className="section-title">Cursor</h3>
              <CopyField value={`{ "mcpServers": { "clayprompts": { "url": "${url}" } } }`} label="Cursor mcp.json" />
              <div className="small muted">
                Add this to <code>~/.cursor/mcp.json</code> (or add a server with the URL above in Cursor&apos;s MCP settings), then click{" "}
                <strong>Connect</strong> next to it to sign in.
              </div>
            </div>
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
            <div className="muted small">Nothing connected yet. Follow one of the steps above.</div>
          )}
          <div className="small muted">
            It acts as you: it sees what you can see, adds items under your name, and edits only items you own or edit, always after showing you a preview.
            It never deletes anything. For recommendations, the assistant sends a short work profile it writes itself; the library uses it for that one answer
            and doesn&apos;t store it.
          </div>
        </section>
      </main>
    </div>
  );
}
