"use client";

import { ArrowLeft, ArrowUp, ChatsCircle, Eye, Heart, NotePencil, Sparkle, Trash, User, X } from "@phosphor-icons/react";
import Link from "next/link";
import { createContext, type FormEvent, Fragment, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { type AiAnswer, type AiChatSummary, type AiEntry, askLibrary, deleteChat, listChats, openChat } from "@/app/ai-search/actions";
import type { Kind } from "@/lib/constants";
import { ago } from "@/lib/format";
import { ApprovalTag, SkillTag, WorkflowTag } from "./Tag";
import styles from "./AiSearch.module.css";

type Entry = AiEntry | { role: "error"; text: string };
/** The item open on the current page, which the assistant can answer questions about. */
export interface AiPage {
  id: string;
  title: string;
  kind: Kind;
}

interface AiApi {
  ask: (q: string) => void;
  openPanel: () => void;
  showHistory: () => void;
  setPage: (p: AiPage | null) => void;
  hasChat: boolean;
}
const AiContext = createContext<AiApi | null>(null);

const SEARCH_EXAMPLES = ["Prep for a discovery call with a fintech CFO", "Turn a Gong transcript into a Slack recap", "Something to write Clay formulas faster"];
const PAGE_EXAMPLES: Record<Kind, string[]> = {
  prompt: ["What does this prompt do?", "What should I fill in, and with what?", "Is there anything similar?"],
  skill: ["What does this skill do?", "How do I install it?", "What's in its files?"],
  workflow: ["Summarise this workflow", "What does it need to run?", "Is it ready to share with a customer?"],
};

/**
 * Ask AI, app-wide. Lives in the root layout so the sidebar and its chat stay
 * open as you move between pages, and knows the item you're viewing (via
 * useAiPage) so you can ask about it. Without the AI_SEARCH flag it renders
 * only its children.
 */
export function AiProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [draft, setDraft] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [canAsk, setCanAsk] = useState(true);
  const [history, setHistory] = useState<AiChatSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [page, setPageState] = useState<AiPage | null>(null);
  const [usePage, setUsePage] = useState(true);
  const [pending, start] = useTransition();
  const [loadingChat, startLoad] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Ref mirrors so ask() (shared through context) always sees the latest chat and page.
  const live = useRef({ chatId, page, usePage, pending, canAsk });
  live.current = { chatId, page, usePage, pending, canAsk };

  const setPage = useCallback((p: AiPage | null) => {
    setPageState((cur) => (cur?.id === p?.id ? cur : p));
    setUsePage(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    // Narrow screens get a scrim and a scroll lock; wide ones make room (html[data-ai-panel] in globals.css).
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    const prev = document.body.style.overflow;
    if (narrow) document.body.style.overflow = "hidden";
    else document.documentElement.setAttribute("data-ai-panel", "");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      document.documentElement.removeAttribute("data-ai-panel");
    };
  }, [open]);

  useEffect(() => {
    if (open && view === "chat") input.current?.focus();
  }, [open, view, chatId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [entries, pending]);

  const ask = useCallback((text: string) => {
    const q = text.trim();
    const { chatId: id, page: pg, usePage: withPage, pending: busy, canAsk: allowed } = live.current;
    if (!q || busy || !allowed) return;
    const viewing = withPage && pg ? { id: pg.id, title: pg.title } : undefined;
    setEntries((cur) => [...cur.filter((e) => e.role !== "error"), { role: "user", text: q, viewing }]);
    setDraft("");
    setOpen(true);
    setView("chat");
    start(async () => {
      const res = await askLibrary({ chatId: id, question: q, pageId: viewing?.id ?? null }).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (res.ok) {
        setChatId(res.data.chatId);
        setCanAsk(res.data.canAsk);
        setEntries((cur) => [...cur, { role: "assistant", answer: res.data.answer }]);
        setHistory(null);
      } else {
        setEntries((cur) => [...cur, { role: "error", text: res.error }]);
      }
    });
  }, []);

  const loadHistory = () => {
    setHistoryError(null);
    startLoad(async () => {
      const res = await listChats().catch(() => ({ ok: false as const, error: "Couldn't load your chats." }));
      if (res.ok) setHistory(res.data);
      else setHistoryError(res.error);
    });
  };
  const showHistory = useCallback(() => {
    setOpen(true);
    setView("history");
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openPanel = useCallback(() => {
    setOpen(true);
    setView("chat");
  }, []);

  const newChat = () => {
    setChatId(null);
    setEntries([]);
    setCanAsk(true);
    setDraft("");
    setView("chat");
  };
  const resume = (id: string) => {
    startLoad(async () => {
      const res = await openChat(id).catch(() => ({ ok: false as const, error: "Couldn't open that chat." }));
      if (!res.ok) {
        setHistoryError(res.error);
        return;
      }
      setChatId(res.data.id);
      setEntries(res.data.entries);
      setCanAsk(res.data.canAsk);
      setView("chat");
    });
  };
  const remove = (id: string) => {
    startLoad(async () => {
      const res = await deleteChat(id).catch(() => ({ ok: false as const, error: "Couldn't delete that chat." }));
      if (!res.ok) {
        setHistoryError(res.error);
        return;
      }
      setHistory((h) => h?.filter((c) => c.id !== id) ?? null);
      if (id === chatId) {
        newChat();
        setView("history");
      }
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(draft);
    }
  };

  const api = useMemo<AiApi | null>(
    () => (enabled ? { ask, openPanel, showHistory, setPage, hasChat: entries.length > 0 } : null),
    [enabled, ask, openPanel, showHistory, setPage, entries.length],
  );
  const pageOn = !!page && usePage;
  const examples = pageOn ? PAGE_EXAMPLES[page.kind] : SEARCH_EXAMPLES;

  return (
    <AiContext.Provider value={api}>
      {children}
      {enabled && open ? (
        <div className={styles.layer}>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden />
          <aside className={styles.panel} role="dialog" aria-label="Ask the library">
            <div className={styles.head}>
              {view === "history" ? (
                <button type="button" className={styles.iconBtn} onClick={() => setView("chat")} aria-label="Back to chat" title="Back to chat">
                  <ArrowLeft size={18} weight="bold" />
                </button>
              ) : (
                <span className={styles.headIcon}>
                  <Sparkle weight="fill" size={15} />
                </span>
              )}
              <div className={styles.headText}>
                <div className={styles.title}>{view === "history" ? "Your chats" : "Ask the library"}</div>
                <div className={styles.sub}>{view === "history" ? "Only you can see these" : "Searches everything you can see, or asks about this page"}</div>
              </div>
              <div className="grow" />
              {view === "chat" ? (
                <>
                  <button type="button" className={styles.iconBtn} onClick={showHistory} aria-label="Chat history" title="Chat history">
                    <ChatsCircle size={18} weight="bold" />
                  </button>
                  <button type="button" className={styles.iconBtn} onClick={newChat} disabled={pending || !entries.length} aria-label="New chat" title="New chat">
                    <NotePencil size={18} weight="bold" />
                  </button>
                </>
              ) : null}
              <button type="button" className={styles.iconBtn} onClick={() => setOpen(false)} aria-label="Close" title="Close">
                <X size={18} weight="bold" />
              </button>
            </div>

            {view === "history" ? (
              <div className={styles.body}>
                {historyError ? (
                  <div className={styles.error} role="alert">
                    {historyError}
                  </div>
                ) : null}
                {history === null ? (
                  historyError ? null : <div className={styles.thinking}>Loading your chats…</div>
                ) : history.length ? (
                  <ul className={styles.history}>
                    {history.map((c) => (
                      <li key={c.id} className={styles.historyItem} data-current={c.id === chatId ? "" : undefined}>
                        <button type="button" className={styles.historyOpen} onClick={() => resume(c.id)} disabled={loadingChat}>
                          <span className={styles.historyTitle}>{c.title}</span>
                          <span className={styles.historyMeta}>{ago(c.updatedAt)}</span>
                        </button>
                        <button type="button" className={styles.iconBtn} onClick={() => remove(c.id)} disabled={loadingChat} aria-label={`Delete “${c.title}”`} title="Delete">
                          <Trash size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No chats yet. Ask something and it&apos;s saved here so you can pick it up later.</p>
                )}
              </div>
            ) : (
              <>
                <div className={styles.body} ref={scroller} aria-live="polite">
                  {!entries.length ? (
                    <div className={styles.empty}>
                      <p className="muted small">
                        {pageOn ? <>Ask anything about <strong>{page.title}</strong>, or search the whole library. Try:</> : "Describe the task in your own words. Each pick comes with a reason it fits you. Try:"}
                      </p>
                      <div className={styles.examples}>
                        {examples.map((x) => (
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
                        {e.viewing ? (
                          <Link href={`/prompts/${e.viewing.id}`} className={styles.about}>
                            <Eye size={12} weight="bold" /> About {e.viewing.title}
                          </Link>
                        ) : null}
                        <div className={styles.userBubble}>{e.text}</div>
                      </div>
                    ) : e.role === "error" ? (
                      <div key={i} className={styles.error} role="alert">
                        {e.text}
                      </div>
                    ) : (
                      <AssistantTurn key={i} answer={e.answer} onFollowUp={ask} last={i === entries.length - 1} canAsk={canAsk && !pending} />
                    ),
                  )}
                  {pending ? (
                    <div className={styles.thinking}>
                      <span className={styles.dots} aria-hidden>
                        <i />
                        <i />
                        <i />
                      </span>
                      {entries.at(-1)?.role === "user" && (entries.at(-1) as { viewing?: unknown }).viewing ? "Reading the page…" : "Looking through the library…"}
                    </div>
                  ) : null}
                </div>

                {page ? (
                  <div className={styles.context}>
                    {usePage ? (
                      <span className={styles.contextChip}>
                        <Eye size={13} weight="bold" />
                        <span className={styles.contextText}>Viewing {page.title}</span>
                        <button type="button" className={styles.contextX} onClick={() => setUsePage(false)} aria-label="Don't use this page" title="Ask without this page">
                          <X size={11} weight="bold" />
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={styles.contextAdd} onClick={() => setUsePage(true)}>
                        <Eye size={13} weight="bold" /> Ask about {page.title}
                      </button>
                    )}
                  </div>
                ) : null}
                <form className={styles.foot} onSubmit={submit}>
                  {canAsk ? (
                    <>
                      <textarea
                        ref={input}
                        className={styles.footInput}
                        rows={1}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={pageOn ? `Ask about this ${page.kind}, or anything else` : entries.length ? "Ask a follow-up" : "What are you trying to do?"}
                        aria-label="Message"
                        maxLength={1500}
                      />
                      <button type="submit" className={styles.send} disabled={!draft.trim() || pending} aria-label="Send">
                        <ArrowUp size={16} weight="bold" />
                      </button>
                    </>
                  ) : (
                    <div className="small muted">This chat is full. Start a new one to keep going.</div>
                  )}
                </form>
                <div className={styles.disclaimer}>AI can make mistakes. Open an item to check it.</div>
              </>
            )}
          </aside>
        </div>
      ) : null}
    </AiContext.Provider>
  );
}

/** Tell the assistant which item this page shows. Renders nothing. */
export function AiPageContext({ id, title, kind }: AiPage) {
  const ai = useContext(AiContext);
  const setPage = ai?.setPage;
  useEffect(() => {
    if (!setPage) return;
    setPage({ id, title, kind });
    return () => setPage(null);
  }, [setPage, id, title, kind]);
  return null;
}

/** The header's Ask AI button, on every page. */
export function AskAiButton({ className }: { className?: string }) {
  const ai = useContext(AiContext);
  if (!ai) return null;
  return (
    <button type="button" className={className} onClick={ai.openPanel} aria-label="Ask AI" title="Ask AI about the library or this page">
      <Sparkle weight="fill" size={15} />
      <span>Ask AI</span>
    </button>
  );
}

/** Discover's Ask AI bar, above the search and filters. */
export function AiBar() {
  const ai = useContext(AiContext);
  const [draft, setDraft] = useState("");
  if (!ai) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    ai.ask(draft);
    setDraft("");
  };
  return (
    <form className={styles.bar} onSubmit={submit} role="search" aria-label="Ask AI">
      <Sparkle weight="fill" size={18} className={styles.spark} aria-hidden />
      <input
        className={styles.barInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ask AI: describe what you're working on, and it finds the best fit"
        aria-label="Ask AI what you're looking for"
        maxLength={1500}
      />
      <button type="button" className={styles.barGhost} onClick={ai.hasChat ? ai.openPanel : ai.showHistory} title={ai.hasChat ? "Back to your chat" : "Your saved chats"}>
        <ChatsCircle size={16} weight="bold" />
        <span className={styles.barGhostLabel}>{ai.hasChat ? "Resume" : "Chats"}</span>
      </button>
      <button type="submit" className={`btn btn-primary ${styles.barBtn}`} disabled={!draft.trim()}>
        Ask
      </button>
    </form>
  );
}

function AssistantTurn({ answer, onFollowUp, last, canAsk }: { answer: AiAnswer; onFollowUp: (q: string) => void; last: boolean; canAsk: boolean }) {
  return (
    <div className={styles.aiTurn}>
      {answer.reply ? <div className={styles.reply}>{renderMarkdown(answer.reply)}</div> : null}
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
                  <span className={styles.why}>{renderInline(c.why)}</span>
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

/** **bold**, *italic* and `code` within a line, as React nodes (never HTML). */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={m.index}>{t.slice(2, -2)}</strong> : t.startsWith("`") ? <code key={m.index}>{t.slice(1, -1)}</code> : <em key={m.index}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Paragraphs plus bulleted or numbered lists. */
function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  // A list run together on one line ("… 1. **A** … 2. **B** …") is split into lines first.
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((l) => ((l.match(/(^|\s)\d+[.)]\s/g) ?? []).length > 1 ? l.split(/\s(?=\d+[.)]\s)/) : [l]));
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{renderInline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const item = /^(?:([-*•])|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const ordered = !item[1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[2]);
    } else if (!line) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^#+\s*/, ""));
    }
  }
  flushPara();
  flushList();
  return blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>);
}
