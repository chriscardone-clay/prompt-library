"use client";

import { CheckSquare, FunnelSimple, LockSimple, MagnifyingGlass, Square, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APP_COLORS,
  APPS,
  AUDIENCES,
  isApp,
  isAudience,
  isSort,
  SORT_LABELS,
  SORTS,
  SURFACES,
  type App,
  type Audience,
  type Kind,
  type Sort,
} from "@/lib/constants";
import { ago, plural } from "@/lib/format";
import type { Profile, Prompt } from "@/lib/types";
import { Avatar } from "./Avatar";
import { AppTag, AudienceTag, ForkTag, SkillTag } from "./Tag";
import { VoteButton } from "./VoteButton";
import styles from "./PromptList.module.css";

interface Props {
  view: "discover" | "mine";
  prompts: Prompt[];
  /** Used for fork counts on the My library view, where `prompts` is a subset. */
  allPrompts?: Prompt[];
  me: Profile;
}

type KindFilter = Kind | "all";

/** "Claude:Chat|Cowork,ChatGPT:Codex" ⇄ { Claude: ["Chat","Cowork"], ChatGPT: ["Codex"] } */
function parseSurfaces(raw: string | null): Partial<Record<App, string[]>> {
  const out: Partial<Record<App, string[]>> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [app, list] = part.split(":");
    if (!isApp(app)) continue;
    const allowed = SURFACES[app] ?? [];
    const picked = (list ?? "").split("|").filter((s) => allowed.includes(s));
    if (picked.length) out[app] = picked;
  }
  return out;
}
function serialiseSurfaces(s: Partial<Record<App, string[]>>): string | null {
  const parts = Object.entries(s)
    .filter(([, v]) => v && v.length)
    .map(([app, v]) => `${app}:${v!.join("|")}`);
  return parts.length ? parts.join(",") : null;
}
const listParam = (v: string[]) => (v.length ? v.join(",") : null);

export function PromptList({ view, prompts, allPrompts, me }: Props) {
  const params = useSearchParams();
  const pathname = usePathname();

  // Filters live in the URL so views are shareable, but we update the URL with
  // history.replaceState (no server round-trip) instead of the router: routing
  // on every keystroke re-ran the page and re-rendered the input from the URL,
  // which raced fast typing and dropped characters.
  const writeUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || (k === "sort" && v === "top")) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      // Pass null state: Next only syncs useSearchParams for replaceState calls
      // that don't carry its own internal history state.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  // The search box is local state for instant feedback; the URL follows it, debounced.
  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const lastWrittenQ = useRef(urlQ);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Only adopt URL changes that didn't originate here (back/forward, external link).
    if (urlQ !== lastWrittenQ.current) {
      lastWrittenQ.current = urlQ;
      setQ(urlQ);
    }
  }, [urlQ]);
  useEffect(() => () => {
    if (qTimer.current) clearTimeout(qTimer.current);
  }, []);
  const onQueryChange = (value: string) => {
    setQ(value);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      lastWrittenQ.current = value;
      writeUrl({ q: value });
    }, 250);
  };
  const clearQuery = () => {
    if (qTimer.current) clearTimeout(qTimer.current);
    setQ("");
    lastWrittenQ.current = "";
    writeUrl({ q: null });
  };

  // ── Filter state (all in the URL) ─────────────────────────────────
  const kindParam = params.get("kind");
  const kind: KindFilter = kindParam === "prompts" ? "prompt" : kindParam === "skills" ? "skill" : "all";
  const apps = (params.get("apps") ?? "").split(",").filter(isApp);
  const surfaces = parseSurfaces(params.get("surfaces"));
  const teams = (params.get("teams") ?? "").split(",").filter(isAudience);
  const sortParam = params.get("sort") ?? "top";
  const sort: Sort = isSort(sortParam) ? sortParam : "top";
  const filtersOpen = params.get("filters") === "1";

  const setApps = (next: App[], nextSurfaces = surfaces) =>
    writeUrl({ apps: listParam(next), surfaces: serialiseSurfaces(nextSurfaces) });
  const toggleApp = (app: App) => {
    const on = apps.includes(app);
    const nextSurfaces = { ...surfaces };
    if (on) delete nextSurfaces[app];
    setApps(on ? apps.filter((a) => a !== app) : [...apps, app], nextSurfaces);
  };
  const toggleSurface = (app: App, sf: string) => {
    const cur = surfaces[app] ?? [];
    const next = { ...surfaces, [app]: cur.includes(sf) ? cur.filter((x) => x !== sf) : [...cur, sf] };
    writeUrl({ surfaces: serialiseSurfaces(next) });
  };
  const toggleTeam = (t: Audience) =>
    writeUrl({ teams: listParam(teams.includes(t) ? teams.filter((x) => x !== t) : [...teams, t]) });
  const clearFilters = () => {
    if (qTimer.current) clearTimeout(qTimer.current);
    setQ("");
    lastWrittenQ.current = "";
    writeUrl({ apps: null, surfaces: null, teams: null, q: null });
  };

  const activeCount = apps.length + Object.values(surfaces).reduce((n, v) => n + (v?.length ?? 0), 0) + teams.length;
  const hasActive = activeCount > 0 || q.trim().length > 0;

  // ── Derived list ──────────────────────────────────────────────────
  const forkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of allPrompts ?? prompts) {
      if (p.parentId) counts.set(p.parentId, (counts.get(p.parentId) ?? 0) + 1);
    }
    return counts;
  }, [allPrompts, prompts]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = kind === "all" ? prompts : prompts.filter((p) => p.kind === kind);
    if (apps.length) {
      out = out.filter((p) =>
        apps.some((app) => {
          const want = surfaces[app] ?? [];
          return p.apps.some(
            (a) =>
              a.app === app &&
              (!want.length || !a.surfaces.length || a.surfaces.some((x) => want.includes(x))),
          );
        }),
      );
    }
    if (teams.length) out = out.filter((p) => p.audiences.some((a) => teams.includes(a)));
    if (needle) {
      out = out.filter((p) =>
        [p.title, p.description, p.body, ...p.files.map((f) => `${f.name} ${f.content}`)]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    const t = (s: string) => new Date(s).getTime();
    return [...out].sort((a, b) => {
      if (sort === "top") {
        return b.upvoteUserIds.length - a.upvoteUserIds.length || t(b.updatedAt) - t(a.updatedAt);
      }
      if (sort === "new") return t(b.createdAt) - t(a.createdAt);
      return t(b.updatedAt) - t(a.updatedAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, kind, q, params.get("apps"), params.get("surfaces"), params.get("teams"), sort]);

  const title =
    view === "mine" ? "My library" : kind === "skill" ? "Discover skills" : kind === "prompt" ? "Discover prompts" : "Discover";
  const countLabel =
    view === "mine"
      ? `${plural(list.length, "item")} you own or edit`
      : plural(list.length, kind === "skill" ? "skill" : kind === "prompt" ? "prompt" : "item");
  const newHref = kind === "skill" ? "/skills/new" : "/prompts/new";
  const newLabel = kind === "skill" ? "New skill" : "New prompt";

  const activeChips: { key: string; label: string; bg: string; fg: string; remove: () => void }[] = [
    ...apps.map((app) => {
      const want = surfaces[app] ?? [];
      return {
        key: `a-${app}`,
        label: want.length ? `${app} · ${want.join(", ")}` : app,
        bg: APP_COLORS[app].bg,
        fg: APP_COLORS[app].fg,
        remove: () => toggleApp(app),
      };
    }),
    ...teams.map((t) => ({ key: `t-${t}`, label: t, bg: "var(--white)", fg: "var(--fg)", remove: () => toggleTeam(t) })),
  ];

  return (
    <section className={styles.section}>
      <div className={styles.titleStack}>
        <h1 className="display-lg">{title}</h1>
        <div className="muted small">{countLabel}</div>
      </div>

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <button
            type="button"
            className={styles.filtersBtn}
            aria-pressed={filtersOpen}
            aria-expanded={filtersOpen}
            data-active={filtersOpen || activeCount > 0 ? "" : undefined}
            onClick={() => writeUrl({ filters: filtersOpen ? null : "1" })}
          >
            <FunnelSimple weight="bold" size={16} />
            Filters
            {activeCount > 0 ? <span className={styles.badge}>{activeCount}</span> : null}
          </button>
          <label className={styles.search}>
            <MagnifyingGlass size={18} className="muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search titles, descriptions, files…"
              aria-label="Search"
            />
            {q ? (
              <button type="button" className={styles.clearSearch} onClick={clearQuery} aria-label="Clear search">
                <X weight="bold" size={13} />
              </button>
            ) : null}
          </label>
          <div className={styles.kindGroup} role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["prompt", "Prompts"],
                ["skill", "Skills"],
              ] as [KindFilter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={styles.kindBtn}
                aria-pressed={kind === k}
                onClick={() => writeUrl({ kind: k === "all" ? null : k === "skill" ? "skills" : "prompts" })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.sortGroup} role="group" aria-label="Sort">
            <span className={`eyebrow ${styles.sortLabel}`}>Sort</span>
            {SORTS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.sortBtn}
                aria-pressed={sort === s}
                onClick={() => writeUrl({ sort: s })}
              >
                {SORT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        {hasActive ? (
          <div className={styles.activeRow}>
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                className={styles.activeChip}
                style={{ background: c.bg, color: c.fg }}
                onClick={c.remove}
                aria-label={`Remove filter ${c.label}`}
              >
                {c.label}
                <X weight="bold" size={10} />
              </button>
            ))}
            <div className="grow" />
            <button type="button" className={styles.clearAllText} onClick={clearFilters}>
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      {/* ── Filters panel + results ── */}
      <div className={styles.body}>
        {filtersOpen ? (
          <aside className={styles.panel} aria-label="Filters">
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>Filters</span>
              <button
                type="button"
                className={styles.panelClose}
                onClick={() => writeUrl({ filters: null })}
                aria-label="Close filters"
              >
                <X weight="bold" size={15} />
              </button>
            </div>

            <div className={styles.group}>
              <span className="eyebrow">App</span>
              <div className={styles.optionList}>
                {APPS.map((app) => {
                  const on = apps.includes(app);
                  const tone = APP_COLORS[app];
                  const surfList = SURFACES[app] ?? [];
                  const want = surfaces[app] ?? [];
                  return (
                    <div key={app} className={styles.optionBlock}>
                      <button
                        type="button"
                        className={styles.option}
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleApp(app)}
                      >
                        {on ? (
                          <CheckSquare weight="fill" size={18} style={{ color: tone.fg }} />
                        ) : (
                          <Square size={18} style={{ color: tone.fg }} />
                        )}
                        <span className="grow">{app}</span>
                      </button>
                      {on && surfList.length ? (
                        <div className={styles.surfaces} style={{ borderColor: tone.bg }}>
                          <span className={styles.surfaceHint}>
                            {want.length ? `${want.length} of ${surfList.length}` : "Any surface"}
                          </span>
                          {surfList.map((sf) => {
                            const sOn = want.includes(sf);
                            return (
                              <button
                                key={sf}
                                type="button"
                                className={`${styles.option} ${styles.optionSm}`}
                                role="checkbox"
                                aria-checked={sOn}
                                onClick={() => toggleSurface(app, sf)}
                              >
                                {sOn ? (
                                  <CheckSquare weight="fill" size={16} style={{ color: tone.fg }} />
                                ) : (
                                  <Square size={16} style={{ color: tone.fg }} />
                                )}
                                {sf}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.group}>
              <span className="eyebrow">Team</span>
              <div className={styles.optionList}>
                {AUDIENCES.map((t) => {
                  const on = teams.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={styles.option}
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleTeam(t)}
                    >
                      {on ? <CheckSquare weight="fill" size={18} /> : <Square size={18} />}
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {hasActive ? (
              <button type="button" className="btn btn-outline btn-sm on-slab" style={{ alignSelf: "flex-start" }} onClick={clearFilters}>
                Clear all
              </button>
            ) : null}
          </aside>
        ) : null}

        <div className={styles.results}>
          {list.length ? (
            <div className={styles.grid}>
              {list.map((p) => (
                <PromptCard key={p.id} prompt={p} forks={forkCounts.get(p.id) ?? 0} meId={me.id} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/Templates.png" alt="" className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>Nothing matches yet</div>
              <div className={styles.emptyText}>
                {kind === "skill"
                  ? "Clear a filter, or share the skill your team keeps rebuilding."
                  : "Clear a filter, or write the prompt your team keeps asking for."}
              </div>
              <div className="row gap-2 wrap" style={{ justifyContent: "center" }}>
                {hasActive ? (
                  <button type="button" className="btn btn-outline on-slab" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
                <Link href={newHref} className="btn btn-primary">
                  {newLabel}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PromptCard({ prompt: p, forks, meId }: { prompt: Prompt; forks: number; meId: string }) {
  const parts: string[] = [];
  if (p.kind === "skill") {
    if (p.files.length) parts.push(plural(p.files.length, "file"));
    if (p.links.length) parts.push(plural(p.links.length, "link"));
  }
  parts.push(`updated ${ago(p.updatedAt)}`);
  if (forks) parts.push(plural(forks, "fork"));
  const meta = parts.join(" · ");

  return (
    <article className={styles.card}>
      <div className={styles.cardTags}>
        {p.kind === "skill" ? <SkillTag /> : null}
        {p.apps.map((a) => (
          <AppTag key={a.app} app={a} />
        ))}
        {p.audiences.map((a) => (
          <AudienceTag key={a} audience={a} light />
        ))}
        {p.parentId ? <ForkTag /> : null}
        <div className="grow" />
        {p.visibility === "private" ? (
          <LockSimple size={16} className="muted" aria-label="Private" />
        ) : null}
      </div>
      <div className={styles.cardBody}>
        <h2 className={styles.cardTitle}>
          <Link href={`/prompts/${p.id}`} className={styles.cardLink}>
            {p.title}
          </Link>
        </h2>
        <p className={`${styles.cardDesc} clamp-2`}>{p.description}</p>
      </div>
      <div className={styles.cardFoot}>
        <Avatar person={p.owner} size={26} />
        <div className={styles.owner}>
          <span className={`${styles.ownerName} truncate`}>{p.owner.name}</span>
          <span className={styles.ownerMeta}>{meta}</span>
        </div>
        <VoteButton
          promptId={p.id}
          count={p.upvoteUserIds.length}
          voted={p.upvoteUserIds.includes(meId)}
        />
      </div>
    </article>
  );
}
