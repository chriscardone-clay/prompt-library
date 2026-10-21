"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { compactDiff, DEFAULT_DUE_DAYS, diffLines, REVIEW_DUE_OPTIONS, RUBRIC } from "@/lib/approval";
import { useToast } from "@/components/Toast";
import { addReviewer, decideReview, removeReviewer, revokeApproval, saveUseCase, setGold } from "./actions";
import styles from "./enablement.module.css";

type ActionResult = { ok: true } | { ok: false; error: string };

function useAct() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();
  const act = (fn: () => Promise<ActionResult>, msg: string, then?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return show(r.error);
      show(msg);
      then?.();
      router.refresh();
    });
  return { pending, act };
}

export interface PaneItem {
  id: string;
  title: string;
  body: string;
  approved: boolean;
  tier: "none" | "approved" | "gold";
  useCaseId: string | null;
}

/** Decide on one item: rubric, use case, next review, note, and the decision. */
export function ReviewPane({
  item,
  snapshot,
  useCases,
  defaultUseCase,
}: {
  item: PaneItem;
  /** The text Enablement last approved, when there is one. */
  snapshot: string | null;
  useCases: { id: string; name: string; goldTitle: string | null }[];
  defaultUseCase: string | null;
}) {
  const [rubric, setRubric] = useState<Record<string, boolean>>({});
  const [useCase, setUseCase] = useState(defaultUseCase ?? item.useCaseId ?? "");
  const [due, setDue] = useState<number>(DEFAULT_DUE_DAYS);
  const [note, setNote] = useState("");
  const { pending, act } = useAct();

  const diff = useMemo(() => (snapshot != null && snapshot !== item.body ? diffLines(snapshot, item.body) : null), [snapshot, item.body]);
  const uc = useCases.find((u) => u.id === useCase);

  const decide = (decision: "approved" | "changes_requested" | "declined", gold = false) =>
    act(
      () => decideReview({ promptId: item.id, decision, gold, useCaseId: useCase || null, note, rubric, dueDays: due }),
      decision === "approved" ? (gold ? "Made the gold standard" : "Approved") : decision === "changes_requested" ? "Changes requested" : "Marked not approved",
      () => setNote(""),
    );

  return (
    <div className="stack" style={{ gap: 20 }}>
      {snapshot != null ? (
        <div className="stack" style={{ gap: 8 }}>
          <span className={styles.label}>Changes since the approved version</span>
          {snapshot === item.body ? (
            <span className={styles.hint}>No changes to the text since it was approved.</span>
          ) : diff ? (
            <div className={styles.diff} role="region" aria-label="Changes since the approved version">
              {compactDiff(diff).map((l, i) =>
                l.op === "gap" ? (
                  <div key={i} className={styles.gap}>
                    … {l.count} unchanged line{l.count === 1 ? "" : "s"}
                  </div>
                ) : (
                  <div key={i} className={l.op === "add" ? styles.add : l.op === "del" ? styles.del : undefined}>
                    {l.op === "add" ? "+ " : l.op === "del" ? "- " : "  "}
                    {l.text || " "}
                  </div>
                ),
              )}
            </div>
          ) : (
            <span className={styles.hint}>Too long to diff here. Compare in Version history on the item.</span>
          )}
        </div>
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        <span className={styles.label}>Rubric</span>
        <div className={styles.rubric}>
          {RUBRIC.map((r) => (
            <label key={r.key} className={styles.rubricRow}>
              <input type="checkbox" checked={!!rubric[r.key]} onChange={(e) => setRubric({ ...rubric, [r.key]: e.target.checked })} />
              <span>
                <strong>{r.label}</strong>
                <br />
                <span className={styles.hint}>{r.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className={styles.two}>
        <label className="field">
          <span className={styles.label}>Use case</span>
          <select className="input" value={useCase} onChange={(e) => setUseCase(e.target.value)}>
            <option value="">None</option>
            {useCases.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            {uc ? (uc.goldTitle ? `Gold standard today: ${uc.goldTitle}` : "No gold standard yet for this use case.") : "Needed to make it a gold standard."}
          </span>
        </label>
        <label className="field">
          <span className={styles.label}>Next review</span>
          <select className="input" value={due} onChange={(e) => setDue(Number(e.target.value))}>
            {REVIEW_DUE_OPTIONS.map((d) => (
              <option key={d} value={d}>
                In {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className={styles.label}>Note to the owner</span>
        <textarea className="textarea" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown in the item's history and sent in the Slack DM." />
      </label>

      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => decide("approved")}>
          Approve
        </button>
        <button type="button" className="btn btn-outline" disabled={pending || !useCase} title={useCase ? undefined : "Pick a use case first"} onClick={() => decide("approved", true)}>
          Approve as gold standard
        </button>
        <button type="button" className="btn btn-outline" disabled={pending} onClick={() => decide("changes_requested")}>
          Request changes
        </button>
        <div className="grow" />
        {item.approved ? (
          <button
            type="button"
            className={`btn btn-outline ${styles.danger}`}
            disabled={pending}
            onClick={() => act(() => revokeApproval(item.id, note), "Approval removed", () => setNote(""))}
          >
            Remove approval
          </button>
        ) : (
          <button type="button" className={`btn btn-outline ${styles.danger}`} disabled={pending} onClick={() => decide("declined")}>
            Not approved
          </button>
        )}
      </div>
    </div>
  );
}

/** Use cases and their gold standards. */
export function UseCasesPanel({
  useCases,
}: {
  useCases: { id: string; name: string; description: string; archived: boolean; gold: { id: string; title: string } | null; candidates: { id: string; title: string }[] }[];
}) {
  const [name, setName] = useState("");
  const [picking, setPicking] = useState<Record<string, string>>({});
  const { pending, act } = useAct();

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={styles.inline}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New use case, e.g. Account research" maxLength={60} aria-label="New use case" />
        <button type="button" className="btn btn-primary" disabled={pending || !name.trim()} onClick={() => act(() => saveUseCase({ name, description: "" }), `Added ${name.trim()}`, () => setName(""))}>
          Add use case
        </button>
      </div>
      {useCases.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Use case</th>
                <th>Gold standard</th>
                <th>Change</th>
                <th>
                  <span className="visually-hidden">Archive</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {useCases.map((u) => (
                <tr key={u.id} style={u.archived ? { opacity: 0.6 } : undefined}>
                  <td>
                    <strong>{u.name}</strong>
                    {u.archived ? <span className="tiny muted"> · archived</span> : null}
                  </td>
                  <td>{u.gold ? <a href={`/prompts/${u.gold.id}`}>{u.gold.title}</a> : <span className="muted">None yet</span>}</td>
                  <td>
                    <div className={styles.inline}>
                      <select
                        className="input"
                        aria-label={`Gold standard for ${u.name}`}
                        value={picking[u.id] ?? ""}
                        onChange={(e) => setPicking({ ...picking, [u.id]: e.target.value })}
                      >
                        <option value="">{u.candidates.length ? "Pick an approved item…" : "Approve an item first"}</option>
                        {u.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={pending || !picking[u.id]}
                        onClick={() => act(() => setGold(u.id, picking[u.id]), "Gold standard set")}
                      >
                        Make gold
                      </button>
                      {u.gold ? (
                        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => act(() => setGold(u.id, null), "Gold standard cleared")}>
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={pending}
                      onClick={() => act(() => saveUseCase({ id: u.id, name: u.name, description: u.description, archived: !u.archived }), u.archived ? "Restored" : "Archived")}
                    >
                      {u.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>No use cases yet. Add the jobs people come to the library for, then pick a gold standard for each.</div>
      )}
      <span className={styles.hint}>
        The gold standard picker lists approved, unchanged items. Replacing a gold standard keeps the old one Enablement approved.
      </span>
    </div>
  );
}

/** Admins: who's on the Enablement team. */
export function ReviewersPanel({ reviewers, domain }: { reviewers: { email: string; addedBy: string | null }[]; domain: string }) {
  const [email, setEmail] = useState("");
  const { pending, act } = useAct();
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={styles.inline}>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${domain}`} aria-label="Reviewer email" />
        <button type="button" className="btn btn-primary" disabled={pending || !email.trim()} onClick={() => act(() => addReviewer(email), `Added ${email.trim()}`, () => setEmail(""))}>
          Add reviewer
        </button>
      </div>
      {reviewers.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <tbody>
              {reviewers.map((r) => (
                <tr key={r.email}>
                  <td>{r.email}</td>
                  <td className="muted small">{r.addedBy ? `Added by ${r.addedBy}` : ""}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => act(() => removeReviewer(r.email), `Removed ${r.email}`)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>No reviewers yet. Admins aren&apos;t reviewers unless they&apos;re on this list.</div>
      )}
    </div>
  );
}
