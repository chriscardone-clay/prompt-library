"use client";

import { ArrowUp, ArrowsClockwise, Heart, Sparkle, User, X } from "@phosphor-icons/react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { type AiAnswer, askLibrary } from "@/app/ai-search/actions";
import { ApprovalTag, SkillTag, WorkflowTag } from "./Tag";
import styles from "./AiSearch.module.css";

type Entry = { role: "user"; text: string } | { role: "assistant"; answer: AiAnswer } | { role: "error"; text: string };

const EXAMPLES = ["Prep for a discovery call with a fintech CFO", "Turn a Gong transcript into a Slack recap", "Something to write Clay formulas faster"];
const MAX_QUESTIONS = 6;

/** Ask AI: a bar above Discover's filters that opens a conversation about the library. */
export function AiSearch({ total }: { total: number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const asked = entries.filter((e) => e.role === "user").length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [entries, pending]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || pending || asked >= MAX_QUESTIONS) return;
    const next: Entry[] = [...entries.filter((e) => e.role !== "error"), { role: "user", text: q }];
    setEntries(next);
    setDraft("");
    setOpen(true);
    type Turn = { role: "user" | "assistant"; text: string; picks?: string[] };
    const turns = next.flatMap((e): Turn[] =>
      e.role === "user"
        ? [{ role: "user", text: e.text }]
        : e.role === "assistant"
          ? [{ role: "assistant", text: e.answer.reply || "(no reply)", picks: e.answer.cards.map((c) => c.id) }]
          : [],
    );
    start(async () => {
      const res = await askLibrary(turns).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      setEntries((cur) => [...cur, res.ok ? { role: "assistant", answer: res.data } : { role: "error", text: res.error }]);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(draft);
    }
  };
  const reset = () => {
    setEntries([]);
    setDraft("");
    input.current?.focus();
  };

  return (
    <>
      <form className={styles.bar} onSubmit={submit} role="search" aria-label="Ask AI">
        <Sparkle weight="fill" size={18} className={styles.spark} aria-hidden />
        <input
          className={styles.barInput}
          value={open ? "" : draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => entries.length && setOpen(true)}
          placeholder="Ask AI: describe what you're working on, and it finds the best fit"
          aria-label="Ask AI what you're looking for"
          maxLength={1500}
        />
        {entries.length && !open ? (
          <button type="button" className={styles.resume} onClick={() => setOpen(true)}>
            Resume
          </button>
        ) : null}
        <button type="submit" className={`btn btn-primary ${styles.barBtn}`} disabled={!draft.trim()}>
          Ask
        </button>
      </form>

      {open ? (
        <div className={styles.layer}>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden />
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ai-title">
            <div className={styles.head}>
              <span className={styles.headIcon}>
                <Sparkle weight="fill" size={16} />
              </span>
              <div className={styles.headText}>
                <div id="ai-title" className={styles.title}>
                  Ask the library
                </div>
                <div className={styles.sub}>Searches the {total} items you can see, and explains each pick for you</div>
              </div>
              <div className="grow" />
              {entries.length ? (
                <button type="button" className={styles.ghost} onClick={reset} disabled={pending}>
                  <ArrowsClockwise size={14} weight="bold" />
                  <span className={styles.ghostLabel}>New search</span>
                </button>
              ) : null}
              <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className={styles.body} ref={scroller} aria-live="polite">
              {!entries.length ? (
                <div className={styles.empty}>
                  <p className="muted small">Describe the task in your own words. Try:</p>
                  <div className={styles.examples}>
                    {EXAMPLES.map((x) => (
                      <button key={x} type="button" className={styles.chip} onClick={() => ask(x)}>
                        {x}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {entries.map((e, i) =>
                e.role === "user" ? (
                  <div key={i} className={styles.userTurn}>
                    <div className={styles.userBubble}>{e.text}</div>
                  </div>
                ) : e.role === "error" ? (
                  <div key={i} className={styles.error} role="alert">
                    {e.text}
                  </div>
                ) : (
                  <AssistantTurn key={i} answer={e.answer} onFollowUp={ask} last={i === entries.length - 1} canAsk={asked < MAX_QUESTIONS} />
                ),
              )}
              {pending ? (
                <div className={styles.thinking}>
                  <span className={styles.dots} aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  Looking through {total} items…
                </div>
              ) : null}
            </div>

            <form className={styles.foot} onSubmit={submit}>
              {asked >= MAX_QUESTIONS ? (
                <div className="small muted">That&apos;s the limit for one conversation. Start a new search to keep going.</div>
              ) : (
                <>
                  <textarea
                    ref={input}
                    className={styles.footInput}
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={entries.length ? "Ask a follow-up: narrow it down, compare, or ask about a pick" : "What are you trying to do?"}
                    aria-label="Message"
                    maxLength={1500}
                  />
                  <button type="submit" className={styles.send} disabled={!draft.trim() || pending} aria-label="Send">
                    <ArrowUp size={16} weight="bold" />
                  </button>
                </>
              )}
            </form>
            <div className={styles.disclaimer}>AI can make mistakes. Open an item to check it before you rely on it.</div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AssistantTurn({ answer, onFollowUp, last, canAsk }: { answer: AiAnswer; onFollowUp: (q: string) => void; last: boolean; canAsk: boolean }) {
  return (
    <div className={styles.aiTurn}>
      {answer.reply ? <p className={styles.reply}>{answer.reply}</p> : null}
      {answer.cards.length ? (
        <ol className={styles.cards}>
          {answer.cards.map((c, i) => (
            <li key={c.id}>
              <Link href={`/prompts/${c.id}`} className={styles.card}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.cardMain}>
                  <span className={styles.cardTags}>
                    <ApprovalTag approval={c.approval} short />
                    {c.kind === "skill" ? <SkillTag /> : c.kind === "workflow" ? <WorkflowTag /> : <span className="tag tag-light">Prompt</span>}
                    {c.apps.slice(0, 2).map((a) => (
                      <span key={a} className="tag tag-light tag-muted">
                        {a}
                      </span>
                    ))}
                    {c.mine ? (
                      <span className={styles.flag}>
                        <User size={11} weight="bold" /> Yours
                      </span>
                    ) : null}
                    {c.favorite ? (
                      <span className={styles.flag}>
                        <Heart size={11} weight="fill" /> Saved
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.cardTitle}>{c.title}</span>
                  <span className={styles.why}>{c.why}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      {last && canAsk && answer.followUps.length ? (
        <div className={styles.examples}>
          {answer.followUps.map((f) => (
            <button key={f} type="button" className={styles.chip} onClick={() => onFollowUp(f)}>
              {f}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
