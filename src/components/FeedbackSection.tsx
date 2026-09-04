"use client";

import { ArrowBendDownRight, ArrowCounterClockwise, Check } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postFeedback, replyToFeedback, setFeedbackResolved } from "@/app/actions";
import { ago } from "@/lib/format";
import type { Feedback, Person } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useToast } from "./Toast";
import styles from "./FeedbackSection.module.css";

interface Props {
  promptId: string;
  feedback: Feedback[];
  me: Person;
  canManage: boolean;
}

export function FeedbackSection({ promptId, feedback, me, canManage }: Props) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const sorted = [...feedback].sort(
    (a, b) =>
      Number(a.resolved) - Number(b.resolved) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const openCount = feedback.filter((f) => !f.resolved).length;

  const submit = () => {
    const t = text.trim();
    if (!t || pending) return;
    start(async () => {
      const res = await postFeedback(promptId, t);
      if (!res.ok) return show(res.error);
      setText("");
      show("Feedback posted");
      router.refresh();
    });
  };

  return (
    <div className={styles.section}>
      <div className={styles.head}>
        <h2 className="display-sm">Feedback</h2>
        <span className="small muted">
          {feedback.length} {feedback.length === 1 ? "note" : "notes"} · {openCount} open
        </span>
      </div>

      <div className={styles.compose}>
        <Avatar person={me} size={32} />
        <div className={styles.composeBody}>
          <textarea
            className="textarea"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What worked? What would you change?"
            aria-label="Feedback"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          <div className={styles.composeActions}>
            <button
              type="button"
              className="btn btn-primary btn-md"
              disabled={!text.trim() || pending}
              onClick={submit}
            >
              Post feedback
            </button>
          </div>
        </div>
      </div>

      <div className={styles.list}>
        {sorted.map((f) => (
          <FeedbackItem key={f.id} item={f} promptId={promptId} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

function FeedbackItem({
  item: f,
  promptId,
  canManage,
}: {
  item: Feedback;
  promptId: string;
  canManage: boolean;
}) {
  const [reply, setReply] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const sendReply = () => {
    const r = reply.trim();
    if (!r || pending) return;
    start(async () => {
      const res = await replyToFeedback(f.id, promptId, r);
      if (!res.ok) return show(res.error);
      setReply("");
      show("Reply posted");
      router.refresh();
    });
  };

  const toggleResolve = () => {
    if (pending) return;
    start(async () => {
      const res = await setFeedbackResolved(f.id, promptId, !f.resolved);
      if (!res.ok) return show(res.error);
      show(f.resolved ? "Reopened" : "Marked resolved");
      router.refresh();
    });
  };

  return (
    <div className={styles.item}>
      <div className={styles.itemHead}>
        <Avatar person={f.author} size={26} />
        <span className={styles.author}>{f.author.name}</span>
        <span className="tiny muted">{ago(f.createdAt)}</span>
        <div className="grow" />
        <span className={`${styles.status} ${f.resolved ? styles.resolved : styles.open}`}>
          {f.resolved ? "Resolved" : "Open"}
        </span>
      </div>
      <div className={styles.text}>{f.text}</div>

      {f.reply ? (
        <div className={styles.reply}>
          <div className={styles.replyHead}>
            <ArrowBendDownRight weight="bold" size={13} />
            <span className={styles.replyName}>{f.replyBy?.name ?? "Editor"}</span> replied
          </div>
          <div className={styles.replyText}>{f.reply}</div>
        </div>
      ) : null}

      {canManage ? (
        <div className={styles.manage}>
          {!f.reply ? (
            <textarea
              className="textarea"
              rows={2}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply — what did you change?"
              aria-label="Reply"
              style={{ fontSize: 13.5, padding: "10px 12px", borderRadius: 10 }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendReply();
              }}
            />
          ) : null}
          <div className={styles.manageActions}>
            {!f.reply ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!reply.trim() || pending}
                onClick={sendReply}
              >
                Reply
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-outline btn-sm on-slab"
              disabled={pending}
              onClick={toggleResolve}
            >
              {f.resolved ? (
                <ArrowCounterClockwise weight="bold" size={13} />
              ) : (
                <Check weight="bold" size={13} />
              )}
              {f.resolved ? "Reopen" : "Mark resolved"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
