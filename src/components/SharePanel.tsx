"use client";

import { Copy, Eye, Link as LinkIcon, LockSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { publishShare, revokeShare, updateShare } from "@/app/share-actions";
import { ago, plural } from "@/lib/format";
import { useToast } from "./Toast";
import styles from "./SharePanel.module.css";

/** Mirrors ShareSummary in lib/shares.ts (server-only). */
export interface ShareRowData {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  expired: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  sourceUpdatedAt: string;
  attachments: string[];
}

interface Props {
  promptId: string;
  customerReady: boolean;
  /** Owner or editor: can mark it customer-ready and sees every link. Others see the links they published. */
  canManage: boolean;
  /** The workflow's attachment names, offered at publish time. */
  attachments: string[];
  shares: ShareRowData[];
  /** The workflow's updated_at, to tell when a link shows an older version. */
  updatedAt: string;
  origin: string;
}

const EXPIRY: [number, string][] = [
  [0, "None"],
  [30, "30 days"],
  [90, "90 days"],
  [365, "365 days"],
];

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** "Published links": anyone can publish a read-only customer link once the workflow is customer-ready. */
export function SharePanel({ promptId, customerReady, canManage, attachments, shares, updatedAt, origin }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(90);
  const [picked, setPicked] = useState<string[]>([]);
  const [published, setPublished] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();
  const urlFor = (token: string) => `${origin}/s/${token}`;

  const publish = () =>
    start(async () => {
      const r = await publishShare(promptId, { label, expiresDays: days as 0 | 30 | 90 | 365, attachments: picked });
      if (!r.ok) return show(r.error);
      setPublished(r.data.url);
      await copyText(r.data.url);
      show("Link published and copied");
      router.refresh();
    });

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return show(r.error ?? "Something went wrong");
      show(msg);
      router.refresh();
    });

  return (
    <div className="slab" style={{ gap: 12 }} id="links">
      <div className={styles.head}>
        <div className="section-title">Published links</div>
        <span className="tiny muted">{canManage ? "Every link" : "Links you published"}</span>
      </div>

      {!customerReady ? (
        <div className={styles.note}>
          <LockSimple size={15} />
          <span className="small">
            {canManage ? (
              <>
                Mark it customer-ready first: <Link href={`/prompts/${promptId}/edit`}>Edit</Link> → Details → Customer-ready.
              </>
            ) : (
              <>Its owner hasn&apos;t marked it customer-ready yet. Ask them, or adapt it and publish your own copy.</>
            )}
          </span>
        </div>
      ) : published ? (
        <div className={styles.form}>
          <b className="small">Link published</b>
          <div className={styles.copyField}>
            <span className={`${styles.url} truncate`}>{published}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => copyText(published).then(() => show("Copied"))}>
              <Copy size={13} />
              Copy
            </button>
          </div>
          <a href={published} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm on-slab" style={{ alignSelf: "flex-start" }}>
            <Eye size={13} />
            Open as customer
          </a>
          <span className="tiny muted">
            It shows this exact version until someone updates it. Anyone with the link can view it without a Clay sign-in.
          </span>
          <button type="button" className="btn btn-outline btn-sm on-slab" style={{ alignSelf: "flex-start" }} onClick={() => { setPublished(null); setOpen(false); setLabel(""); setPicked([]); }}>
            Done
          </button>
        </div>
      ) : open ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            publish();
          }}
        >
          <label className="field">
            <span className="eyebrow">Label</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme onboarding" maxLength={120} />
            <span className="tiny muted">Only you and your editors see this.</span>
          </label>
          <div className="field">
            <span className="eyebrow">Expires</span>
            <div className={styles.pills} role="group" aria-label="Expires">
              {EXPIRY.map(([d, l]) => (
                <button key={d} type="button" className={styles.pill} aria-pressed={days === d} onClick={() => setDays(d)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {attachments.length ? (
            <div className="field">
              <span className="eyebrow">Attachments to include</span>
              {attachments.map((a) => (
                <label key={a} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={picked.includes(a)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, a] : picked.filter((x) => x !== a))}
                  />
                  <span className="small truncate">{a}</span>
                </label>
              ))}
            </div>
          ) : null}
          <span className="tiny muted">
            The customer sees the title, the description, the document, Download .md and any attachments you tick. Not your notes,
            feedback, owners or history.
          </span>
          <div className="row gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              <LinkIcon size={13} />
              {pending ? "Publishing…" : "Publish link"}
            </button>
            <button type="button" className="btn btn-outline btn-sm on-slab" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-outline btn-sm on-slab" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
          <LinkIcon size={13} />
          Publish a customer link
        </button>
      )}

      {shares.length ? (
        <div className={styles.list}>
          {shares.map((s) => {
            const behind = new Date(s.sourceUpdatedAt).getTime() < new Date(updatedAt).getTime();
            return (
              <div key={s.id} className={styles.row}>
                <div className={styles.rowHead}>
                  <b className="small truncate">{s.label || "Untitled link"}</b>
                  {s.expired ? (
                    <span className={styles.badge}>Expired</span>
                  ) : behind ? (
                    <span className={styles.badge}>Behind latest</span>
                  ) : null}
                </div>
                <span className="tiny muted">
                  {s.createdBy ? `${s.createdBy} · ` : ""}created {ago(s.createdAt)} ·{" "}
                  {s.expiresAt ? (s.expired ? "expired" : `expires ${new Date(s.expiresAt).toLocaleDateString()}`) : "no expiry"} ·{" "}
                  {plural(s.viewCount, "view")}
                  {s.attachments.length ? ` · ${plural(s.attachments.length, "attachment")}` : ""}
                </span>
                <div className="row gap-2 wrap">
                  <button type="button" className="btn btn-outline btn-sm on-slab" onClick={() => copyText(urlFor(s.token)).then(() => show("Link copied"))}>
                    Copy
                  </button>
                  {behind && customerReady ? (
                    <button type="button" className="btn btn-outline btn-sm on-slab" disabled={pending} onClick={() => act(() => updateShare(s.id), "Link now shows the latest version")}>
                      Update
                    </button>
                  ) : null}
                  <button type="button" className={`btn btn-outline btn-sm on-slab ${styles.danger}`} disabled={pending} onClick={() => act(() => revokeShare(s.id), "Link revoked")}>
                    Revoke
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : customerReady && !open && !published ? (
        <span className="small muted">No customer links yet. Publish one to share a read-only copy without a Clay sign-in.</span>
      ) : null}
    </div>
  );
}
