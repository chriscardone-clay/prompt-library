"use client";

import { ArrowSquareOut, PaperPlaneTilt, Check, ChatCircleDots } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { saveDigestSettings, sendDigestNow, sendDigestTest } from "@/app/admin/actions";
import type { DigestMessage, DigestRun, DigestSettings, SlackBlock } from "@/lib/digest/types";
import type { WindowKind } from "@/lib/digest/run";
import { useToast } from "./Toast";
import styles from "./DigestPanel.module.css";

interface Props {
  settings: DigestSettings;
  runs: DigestRun[];
  preview: { label: string; weekStart: string; message: DigestMessage } | null;
  previewError?: string | null;
  windowKind: WindowKind;
  slackReady: boolean;
  meEmail: string;
}

export function DigestPanel({ settings, runs, preview, previewError, windowKind, slackReady, meEmail }: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ enabled: settings.enabled, channel: settings.channel, editors_note: settings.editors_note });
  const [force, setForce] = useState(false);
  useEffect(() => setDraft({ enabled: settings.enabled, channel: settings.channel, editors_note: settings.editors_note }), [settings]);
  const dirty = draft.enabled !== settings.enabled || draft.channel !== settings.channel || draft.editors_note !== settings.editors_note;

  const save = () =>
    start(async () => {
      const res = await saveDigestSettings(draft);
      show(res.ok ? "Digest settings saved" : res.error);
      if (res.ok) router.refresh();
    });
  const test = () =>
    start(async () => {
      const res = await sendDigestTest(windowKind);
      show(res.ok ? `Sent to ${res.data.where}` : res.error);
      if (res.ok) router.refresh();
    });
  const sendNow = () =>
    start(async () => {
      const res = await sendDigestNow(windowKind, force);
      show(res.ok ? `Posted to ${res.data.where}` : res.error);
      if (res.ok) {
        setForce(false);
        router.refresh();
      }
    });

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <h2 className="section-title">Weekly digest</h2>
        <span className="tiny muted">Posts every Monday at 9:00 ET to Slack. Only public items are ever mentioned.</span>
      </div>

      {!slackReady ? (
        <div className={styles.warn}>
          Slack isn't connected on the server yet: set <code>SLACK_BOT_TOKEN</code> in Vercel (scopes chat:write, im:write, users:read, users:read.email) and redeploy.
        </div>
      ) : null}

      <div className={styles.settings}>
        <label className={styles.toggle}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          <span>
            <b>{draft.enabled ? "Enabled" : "Disabled"}</b>
            <span className="tiny muted"> — the Monday post only goes out while this is on.</span>
          </span>
        </label>
        <label className="field">
          <span className="eyebrow">Slack channel ID</span>
          <input
            className={`input ${styles.mono}`}
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value.trim() })}
            placeholder="C0123456789"
            spellCheck={false}
          />
          <span className="tiny muted">Open #auto-clayprompts → channel name → About → copy the Channel ID. Invite the bot to the channel first.</span>
        </label>
        <label className="field">
          <span className="eyebrow">Editors' note for the next issue</span>
          <input
            className="input"
            value={draft.editors_note}
            onChange={(e) => setDraft({ ...draft, editors_note: e.target.value })}
            placeholder="One line, e.g. Share your best Claygent prompts before Friday's offsite."
            maxLength={300}
          />
          <span className="tiny muted">Becomes the last “Worth knowing” bullet, then clears itself after it's sent.</span>
        </label>
        {dirty ? (
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={save}>
              <Check weight="bold" size={13} />
              Save settings
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm on-slab"
              disabled={pending}
              onClick={() => setDraft({ enabled: settings.enabled, channel: settings.channel, editors_note: settings.editors_note })}
            >
              Discard
            </button>
          </div>
        ) : null}
      </div>

      <div className={styles.previewHead}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">Preview</span>
          <span className="tiny muted">{preview ? preview.label : "—"}</span>
        </div>
        <div className={styles.seg} role="group" aria-label="Preview window">
          <Link href="/admin?window=last" className={styles.segBtn} aria-current={windowKind === "last" ? "true" : undefined} scroll={false}>
            Last full week
          </Link>
          <Link href="/admin?window=rolling" className={styles.segBtn} aria-current={windowKind === "rolling" ? "true" : undefined} scroll={false}>
            Last 7 days
          </Link>
        </div>
      </div>

      {previewError ? <div className={styles.warn}>{previewError}</div> : null}
      {preview ? <SlackPreview message={preview.message} /> : null}

      <div className={styles.sendRow}>
        <button type="button" className="btn btn-outline btn-sm on-slab" disabled={pending || !slackReady} onClick={test} title={`DM ${meEmail}`}>
          <ChatCircleDots size={14} />
          Send test to me
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending || !slackReady || !settings.channel} onClick={sendNow}>
          <PaperPlaneTilt weight="fill" size={13} />
          Post to channel now
        </button>
        <label className={styles.check}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Post again anyway
        </label>
        <span className="tiny muted">Test goes to your DMs only. “Post to channel now” uses the window selected above and counts as that week's post.</span>
      </div>

      <div className={styles.runs}>
        <span className="eyebrow">Recent sends</span>
        {runs.length ? (
          <div className={styles.runList}>
            {runs.map((r) => (
              <div key={r.id} className={styles.run}>
                <span className={`${styles.kind} ${styles[`kind_${r.kind}`]}`}>{r.kind === "channel" ? "Channel" : r.kind === "resend" ? "Resend" : "Test"}</span>
                <span>Week of {r.week_start}</span>
                <span className="tiny muted">
                  {new Date(r.posted_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.posted_by}
                </span>
                <span className="tiny muted">
                  {r.stats?.new ?? 0} new · {r.stats?.upvotes ?? 0} upvotes
                </span>
                {r.slack_ts ? (
                  <a
                    className={styles.runLink}
                    href={`https://clay-hq.slack.com/archives/${r.channel}/p${r.slack_ts.replace(".", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Slack <ArrowSquareOut size={12} />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <span className="tiny muted">Nothing sent yet.</span>
        )}
      </div>
    </div>
  );
}

// ── Block Kit → HTML approximation ─────────────────────────────────
function mrkdwn(text: string): string {
  const escaped = text.replace(/&(?!amp;|lt;|gt;)/g, "&amp;");
  return escaped
    .replace(/<((?:https?:)[^|>]+)\|([^>]+)>/g, (_m, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/<((?:https?:)[^>]+)>/g, (_m, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,:;!?])/g, "$1<i>$2</i>")
    .replace(/\n/g, "<br />");
}

function textOf(b: SlackBlock): string {
  const t = b.text as { text?: string } | undefined;
  return t?.text ?? "";
}

function SlackPreview({ message }: { message: DigestMessage }) {
  return (
    <div className={styles.slack} aria-label="Preview of the Slack message">
      <div className={styles.slackWho}>
        <span className={styles.slackAvatar} aria-hidden="true" />
        <b>Clay Prompt Library</b>
        <span className={styles.slackApp}>App</span>
      </div>
      <div className={styles.slackBody}>
        {message.blocks.map((b, i) => {
          switch (b.type) {
            case "header":
              return <div key={i} className={styles.slackHeader}>{textOf(b)}</div>;
            case "context": {
              const els = (b.elements as { text: string }[]) ?? [];
              return <div key={i} className={styles.slackContext} dangerouslySetInnerHTML={{ __html: els.map((e) => mrkdwn(e.text)).join(" ") }} />;
            }
            case "divider":
              return <hr key={i} className={styles.slackDivider} />;
            case "section": {
              const acc = b.accessory as { text?: { text: string }; url?: string } | undefined;
              return (
                <div key={i} className={styles.slackSection}>
                  <div dangerouslySetInnerHTML={{ __html: mrkdwn(textOf(b)) }} />
                  {acc?.url ? (
                    <a className={styles.slackBtn} href={acc.url} target="_blank" rel="noopener noreferrer">
                      {acc.text?.text ?? "Open"}
                    </a>
                  ) : null}
                </div>
              );
            }
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
