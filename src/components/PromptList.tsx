"use client";

import { ArrowRight, CheckSquare, Cpu, FunnelSimple, GitFork, LockSimple, MagnifyingGlass, Medal, ShieldCheck, Square, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeApps,
  activeTeams,
  toneStyle,
  appTone,
  catalogIntegration,
  isKnownApp,
  REQUIRED_TONE,
  isKnownTeam,
  surfacesOf,
  type Catalog,
} from "@/lib/catalog";
import { isSort, isTrigger, SORT_LABELS, SORTS, TRIGGER_LABELS, WORKFLOW_TRIGGERS, type Kind, type Sort } from "@/lib/constants";
import { approvalBoost, approvalRank, compareRecommended } from "@/lib/approval";
import { ago, plural } from "@/lib/format";
import { searchPrompts } from "@/lib/search";
import type { Profile, Prompt } from "@/lib/types";
import { Avatar } from "./Avatar";
import { FavoriteButton } from "./FavoriteButton";
import { ApprovalTag, AppTag, IntegrationTag, SkillTag, WorkflowTag } from "./Tag";
import { VoteButton } from "./VoteButton";
import styles from "./PromptList.module.css";

interface Props {
  view: "discover" | "mine" | "favorites";
  prompts: Prompt[];
  /** Used for fork counts on the Created / Favorites views, where `prompts` is a subset. */
  allPrompts?: Prompt[];
  me: Profile;
  catalog: Catalog;
  /** Workflows are in beta: only people in WORKFLOWS_BETA (and admins) see the tab. */
  workflowsOn?: boolean;
  /** Admins and Workflow maintainers get a link to the Integrations catalog. */
  manageIntegrations?: boolean;
  /** ENABLEMENT_APPROVED: Recommended sort, the approved filter and the gold standards shelf. */
  enablementOn?: boolean;
}

type Origin = "all" | "reference" | "adapted";

type KindFilter = Kind | "all";

/** "Claude:Chat|Cowork,ChatGPT:Codex" ⇄ { Claude: ["Chat","Cowork"], ChatGPT: ["Codex"] } */
function parseSurfaces(raw: string | null, catalog: Catalog): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [app, list] = part.split(":");
    if (!isKnownApp(catalog, app)) continue;
    const allowed = surfacesOf(catalog, app);
    const picked = (list ?? "").split("|").filter((s) => allowed.includes(s));
    if (picked.length) out[app] = picked;
  }
  return out;
}
function serialiseSurfaces(s: Record<string, string[]>): string | null {
  const parts = Object.entries(s)
    .filter(([, v]) => v && v.length)
    .map(([app, v]) => `${app}:${v!.join("|")}`);
  return parts.length ? parts.join(",") : null;
}
const listParam = (v: string[]) => (v.length ? v.join(",") : null);

export function PromptList({ view, prompts, allPrompts, me, catalog, workflowsOn = false, manageIntegrations = false, enablementOn = false }: Props) {
  const defaultSort: Sort = enablementOn ? "recommended" : "top";
  const sorts = enablementOn ? SORTS : SORTS.filter((s) => s !== "recommended");
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
        if (v === null || v === "" || (k === "sort" && v === defaultSort)) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      // Pass null state: Next only syncs useSearchParams for replaceState calls
      // that don't carry its own internal history state.
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, defaultSort],
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
  const kind: KindFilter =
    kindParam === "prompts" ? "prompt" : kindParam === "skills" ? "skill" : kindParam === "workflows" && workflowsOn ? "workflow" : "all";
  const isWf = kind === "workflow";
  const originParam = params.get("origin");
  const origin: Origin = isWf && (originParam === "reference" || originParam === "adapted") ? originParam : "all";
  const triggers = isWf ? (params.get("triggers") ?? "").split(",").filter(isTrigger) : [];
  const integrations = isWf ? (params.get("integrations") ?? "").split(",").filter(Boolean) : [];
  const readyOnly = isWf && params.get("ready") === "1";
  const apps = (params.get("apps") ?? "").split(",").filter((a) => isKnownApp(catalog, a));
  const surfaces = parseSurfaces(params.get("surfaces"), catalog);
  const teams = (params.get("teams") ?? "").split(",").filter((t) => isKnownTeam(catalog, t));
  const sortParam = params.get("sort") ?? defaultSort;
  const sort: Sort = isSort(sortParam) && (sorts as readonly string[]).includes(sortParam) ? sortParam : defaultSort;
  const approvedParam = enablementOn ? params.get("approved") : null;
  const approvedFilter: "approved" | "gold" | null = approvedParam === "gold" ? "gold" : approvedParam === "1" ? "approved" : null;
  const filtersOpen = params.get("filters") === "1";

  const setApps = (next: string[], nextSurfaces = surfaces) =>
    writeUrl({ apps: listParam(next), surfaces: serialiseSurfaces(nextSurfaces) });
  const toggleApp = (app: string) => {
    const on = apps.includes(app);
    const nextSurfaces = { ...surfaces };
    if (on) delete nextSurfaces[app];
    setApps(on ? apps.filter((a) => a !== app) : [...apps, app], nextSurfaces);
  };
  const toggleSurface = (app: string, sf: string) => {
    const cur = surfaces[app] ?? [];
    const next = { ...surfaces, [app]: cur.includes(sf) ? cur.filter((x) => x !== sf) : [...cur, sf] };
    writeUrl({ surfaces: serialiseSurfaces(next) });
  };
  const toggleTeam = (t: string) =>
    writeUrl({ teams: listParam(teams.includes(t) ? teams.filter((x) => x !== t) : [...teams, t]) });
  const toggleTrigger = (t: string) =>
    writeUrl({ triggers: listParam(triggers.includes(t as never) ? triggers.filter((x) => x !== t) : [...triggers, t]) });
  const toggleIntegration = (i: string) =>
    writeUrl({ integrations: listParam(integrations.includes(i) ? integrations.filter((x) => x !== i) : [...integrations, i]) });
  const clearFilters = () => {
    if (qTimer.current) clearTimeout(qTimer.current);
    setQ("");
    lastWrittenQ.current = "";
    writeUrl({ apps: null, surfaces: null, teams: null, q: null, triggers: null, integrations: null, ready: null, approved: null });
  };

  const activeCount =
    apps.length +
    Object.values(surfaces).reduce((n, v) => n + (v?.length ?? 0), 0) +
    teams.length +
    triggers.length +
    integrations.length +
    (readyOnly ? 1 : 0) +
    (approvedFilter ? 1 : 0);

  // Integrations to filter by: whatever the visible workflows use, most used first.
  const integrationOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of prompts) {
      if (p.kind !== "workflow") continue;
      for (const i of p.workflow.integrations) counts.set(i, (counts.get(i) ?? 0) + 1);
    }
    for (const i of integrations) if (!counts.has(i)) counts.set(i, 0);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  }, [prompts, integrations]);
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
    if (triggers.length) out = out.filter((p) => p.workflow.trigger !== "" && triggers.includes(p.workflow.trigger));
    if (integrations.length) {
      const want = integrations.map((i) => i.toLowerCase());
      out = out.filter((p) => p.workflow.integrations.some((i) => want.includes(i.toLowerCase())));
    }
    if (readyOnly) out = out.filter((p) => p.workflow.customerReady);
    if (approvedFilter) out = out.filter((p) => approvalRank(p.approval) >= (approvedFilter === "gold" ? 2 : 1));
    // Ranked search over title, description, notes/apps/teams and the prompt text
    // (SKILL.md for skills). While searching, relevance orders the list.
    const relevance = new Map<string, number>();
    if (needle) {
      const hits = searchPrompts(out, needle, catalog.apps.map((a) => a.name));
      // Approval reorders matches; it never adds items that didn't match.
      const byId = new Map(out.map((p) => [p.id, p]));
      for (const h of hits) relevance.set(h.id, h.score + approvalBoost(byId.get(h.id)!.approval));
      out = out.filter((p) => relevance.has(p.id));
    }
    const t = (s: string) => new Date(s).getTime();
    return [...out].sort((a, b) => {
      if (needle) {
        const d = (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0);
        if (Math.abs(d) > 1e-6) return d;
      }
      if (sort === "recommended") return compareRecommended(a, b);
      if (sort === "top") {
        return b.upvoteUserIds.length - a.upvoteUserIds.length || t(b.updatedAt) - t(a.updatedAt);
      }
      if (sort === "new") return t(b.createdAt) - t(a.createdAt);
      return t(b.updatedAt) - t(a.updatedAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, kind, q, params.get("apps"), params.get("surfaces"), params.get("teams"), params.get("triggers"), params.get("integrations"), readyOnly, approvedFilter, sort, catalog]);

  // Gold standards shelf: Discover's landing view only (no search, no filters).
  const gold = useMemo(
    () =>
      enablementOn && view === "discover"
        ? prompts.filter((p) => approvalRank(p.approval) === 2 && (kind === "all" || p.kind === kind)).sort(compareRecommended)
        : [],
    [enablementOn, view, prompts, kind],
  );

  // Reference architectures vs adaptations, counted before the toggle narrows the list.
  const originCounts = isWf
    ? { all: list.length, reference: list.filter((p) => !p.parentId).length, adapted: list.filter((p) => !!p.parentId).length }
    : null;
  const shown = origin === "all" ? list : list.filter((p) => (origin === "adapted" ? !!p.parentId : !p.parentId));

  const title =
    view === "mine"
      ? "Created"
      : view === "favorites"
        ? "Favorites"
        : kind === "skill"
          ? "Discover skills"
          : kind === "prompt"
            ? "Discover prompts"
            : kind === "workflow"
              ? "Discover workflows"
              : "Discover";
  const countLabel =
    view === "mine"
      ? `${plural(shown.length, "item")} you own or edit`
      : view === "favorites"
        ? `${plural(shown.length, "item")} you saved`
        : plural(shown.length, kind === "all" ? "item" : kind);
  const newHref = kind === "skill" ? "/skills/new" : kind === "workflow" ? "/workflows/new" : "/prompts/new";
  const newLabel = kind === "skill" ? "New skill" : kind === "workflow" ? "New workflow" : "New prompt";

  const activeChips: { key: string; label: string; bg: string; fg: string; remove: () => void }[] = [
    ...apps.map((app) => {
      const want = surfaces[app] ?? [];
      return {
        key: `a-${app}`,
        label: want.length ? `${app} · ${want.join(", ")}` : app,
        bg: appTone(catalog, app).bg,
        fg: appTone(catalog, app).fg,
        remove: () => toggleApp(app),
      };
    }),
    ...teams.map((t) => ({ key: `t-${t}`, label: t, bg: "var(--white)", fg: "var(--fg)", remove: () => toggleTeam(t) })),
    ...triggers.map((t) => ({ key: `tr-${t}`, label: `Trigger: ${TRIGGER_LABELS[t]}`, bg: "var(--white)", fg: "var(--fg)", remove: () => toggleTrigger(t) })),
    ...integrations.map((i) => ({ key: `i-${i}`, label: i, bg: "var(--white)", fg: "var(--fg)", remove: () => toggleIntegration(i) })),
    ...(readyOnly ? [{ key: "ready", label: "Customer-ready", bg: "var(--white)", fg: "var(--fg)", remove: () => writeUrl({ ready: null }) }] : []),
    ...(approvedFilter
      ? [{ key: "approved", label: approvedFilter === "gold" ? "Gold standards" : "Enablement approved", bg: "var(--white)", fg: "var(--fg)", remove: () => writeUrl({ approved: null }) }]
      : []),
  ];

  return (
    <section className={styles.section}>
      <div className={styles.titleRow}>
        <div className={styles.titleStack}>
          <h1 className="display-lg">{title}</h1>
          <div className="muted small">{countLabel}</div>
        </div>
        {isWf ? (
          <div className="row gap-2 wrap">
            {manageIntegrations ? (
              <Link href="/admin/integrations" className="btn btn-outline">
                Integrations
              </Link>
            ) : null}
            <Link href="/workflows/new" className="btn btn-outline">
              New workflow
            </Link>
          </div>
        ) : null}
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
                ...(workflowsOn ? [["workflow", "Workflows"]] : []),
              ] as [KindFilter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={styles.kindBtn}
                aria-pressed={kind === k}
                onClick={() =>
                  writeUrl({
                    kind: k === "all" ? null : `${k}s`,
                    // Workflow-only filters don't apply to the other kinds.
                    ...(k === "workflow" ? {} : { origin: null, triggers: null, integrations: null, ready: null }),
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.sortGroup} role="group" aria-label="Sort">
            <span className={`eyebrow ${styles.sortLabel}`}>Sort</span>
            {sorts.map((s) => (
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
          {enablementOn ? (
            <button
              type="button"
              className={styles.filtersBtn}
              aria-pressed={!!approvedFilter}
              data-active={approvedFilter ? "" : undefined}
              onClick={() => writeUrl({ approved: approvedFilter ? null : "1" })}
            >
              <ShieldCheck weight="bold" size={16} />
              Enablement approved
            </button>
          ) : null}
        </div>
        {originCounts ? (
          <div className={styles.activeRow}>
            <div className={styles.kindGroup} role="group" aria-label="Reference architectures or adaptations">
              {(
                [
                  ["all", "All", originCounts.all],
                  ["reference", "Reference architectures", originCounts.reference],
                  ["adapted", "Adaptations", originCounts.adapted],
                ] as [Origin, string, number][]
              ).map(([o, label, n]) => (
                <button
                  key={o}
                  type="button"
                  className={styles.kindBtn}
                  aria-pressed={origin === o}
                  onClick={() => writeUrl({ origin: o === "all" ? null : o })}
                >
                  {label} <span className={styles.badge}>{n}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {hasActive ? (
          <div className={styles.activeRow}>
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`${styles.activeChip} tone`}
                style={toneStyle(c)}
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
                {activeApps(catalog).map(({ name: app }) => {
                  const on = apps.includes(app);
                  const tone = appTone(catalog, app);
                  const surfList = surfacesOf(catalog, app);
                  const want = surfaces[app] ?? [];
                  return (
                    <div key={app} className={`${styles.optionBlock} tone`} style={toneStyle(tone)}>
                      <button
                        type="button"
                        className={styles.option}
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleApp(app)}
                      >
                        {on ? (
                          <CheckSquare weight="fill" size={18} style={{ color: "var(--tone-ink)" }} />
                        ) : (
                          <Square size={18} style={{ color: "var(--tone-ink)" }} />
                        )}
                        <span className="grow">{app}</span>
                      </button>
                      {on && surfList.length ? (
                        <div className={styles.surfaces} style={{ borderColor: "var(--tone-surface)" }}>
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
                                  <CheckSquare weight="fill" size={16} style={{ color: "var(--tone-ink)" }} />
                                ) : (
                                  <Square size={16} style={{ color: "var(--tone-ink)" }} />
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
                {activeTeams(catalog).map(({ name: t }) => {
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

            {enablementOn ? (
              <div className={styles.group}>
                <span className="eyebrow">Enablement</span>
                <div className={styles.optionList}>
                  {(
                    [
                      ["approved", "1", "Enablement approved"],
                      ["gold", "gold", "Gold standards only"],
                    ] as const
                  ).map(([key, value, label]) => {
                    const on = approvedFilter === key;
                    return (
                      <button key={key} type="button" className={styles.option} role="checkbox" aria-checked={on} onClick={() => writeUrl({ approved: on ? null : value })}>
                        {on ? <CheckSquare weight="fill" size={18} /> : <Square size={18} />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {isWf ? (
              <>
                <div className={styles.group}>
                  <span className="eyebrow">Trigger</span>
                  <div className={styles.optionList}>
                    {WORKFLOW_TRIGGERS.map((t) => {
                      const on = triggers.includes(t);
                      return (
                        <button key={t} type="button" className={styles.option} role="checkbox" aria-checked={on} onClick={() => toggleTrigger(t)}>
                          {on ? <CheckSquare weight="fill" size={18} /> : <Square size={18} />}
                          {TRIGGER_LABELS[t]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {integrationOptions.length ? (
                  <div className={styles.group}>
                    <span className="eyebrow">Integrations</span>
                    <div className={styles.optionList}>
                      {integrationOptions.map((i) => {
                        const on = integrations.includes(i);
                        return (
                          <button key={i} type="button" className={styles.option} role="checkbox" aria-checked={on} onClick={() => toggleIntegration(i)}>
                            {on ? <CheckSquare weight="fill" size={18} /> : <Square size={18} />}
                            {i}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className={styles.group}>
                  <span className="eyebrow">Sharing</span>
                  <div className={styles.optionList}>
                    <button
                      type="button"
                      className={styles.option}
                      role="checkbox"
                      aria-checked={readyOnly}
                      onClick={() => writeUrl({ ready: readyOnly ? null : "1" })}
                    >
                      {readyOnly ? <CheckSquare weight="fill" size={18} /> : <Square size={18} />}
                      Customer-ready only
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {hasActive ? (
              <button type="button" className="btn btn-outline btn-sm on-slab" style={{ alignSelf: "flex-start" }} onClick={clearFilters}>
                Clear all
              </button>
            ) : null}
          </aside>
        ) : null}

        <div className={styles.results}>
          {gold.length && !hasActive && origin === "all" ? (
            <section className={styles.shelf} aria-labelledby="gold-shelf">
              <div className={styles.shelfHead}>
                <span className={styles.shelfIcon} aria-hidden="true">
                  <Medal weight="bold" size={18} />
                </span>
                <div className="grow">
                  <h2 id="gold-shelf" className={styles.shelfTitle}>
                    Gold standards
                  </h2>
                  <div className="small muted">Enablement&apos;s best answer for each common job. Start here.</div>
                </div>
                {gold.length > 3 ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => writeUrl({ approved: "gold" })}>
                    All {gold.length}
                    <ArrowRight weight="bold" size={13} />
                  </button>
                ) : null}
              </div>
              <div className={styles.shelfRow}>
                {gold.slice(0, 3).map((p) => (
                  <Link key={p.id} href={`/prompts/${p.id}`} className={styles.goldCard}>
                    <span className={styles.useCase}>{p.approval.useCase || (p.kind === "workflow" ? "Workflow" : p.kind === "skill" ? "Skill" : "Prompt")}</span>
                    <span className={styles.goldTitle}>{p.title}</span>
                    <span className={`${styles.cardDesc} clamp-2`}>{p.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {shown.length ? (
            <div className={styles.grid}>
              {shown.map((p) => (
                <PromptCard key={p.id} prompt={p} forks={forkCounts.get(p.id) ?? 0} meId={me.id} catalog={catalog} />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={view === "favorites" && !hasActive ? "/icons/Heart.png" : "/icons/Templates.png"} alt="" className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>{view === "favorites" && !hasActive ? "Nothing saved yet" : "Nothing matches yet"}</div>
              <div className={styles.emptyText}>
                {view === "favorites" && !hasActive
                  ? "Tap the heart on any prompt or skill to keep it here for quick access."
                  : kind === "skill"
                    ? "Clear a filter, or share the skill your team keeps rebuilding."
                    : kind === "workflow"
                      ? hasActive || origin !== "all"
                        ? "No workflows match these filters. Try removing one."
                        : "No workflows yet. Upload your first architecture .md."
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

function PromptCard({ prompt: p, forks, meId, catalog }: { prompt: Prompt; forks: number; meId: string; catalog: Catalog }) {
  if (p.kind === "workflow") return <WorkflowCard prompt={p} forks={forks} meId={meId} catalog={catalog} />;
  const parts: string[] = [];
  if (p.kind === "skill") {
    if (p.files.length) parts.push(plural(p.files.length, "file"));
    if (p.links.length) parts.push(plural(p.links.length, "link"));
  }
  parts.push(`updated ${ago(p.updatedAt)}`);
  if (forks) parts.push(plural(forks, "fork"));
  const meta = parts.join(" · ");
  const required = p.apps.find((a) => a.required && a.model);

  return (
    <article className={styles.card}>
      <div className={styles.cardTags}>
        <ApprovalTag approval={p.approval} short />
        {p.kind === "skill" ? <SkillTag /> : null}
        {p.apps.slice(0, 2).map((a) => (
          <AppTag key={a.app} app={a} tone={appTone(catalog, a.app)} short />
        ))}
        {p.apps.length > 2 ? (
          <span className="tag tag-light tag-muted" title={p.apps.slice(2).map((a) => a.app).join(", ")}>
            +{p.apps.length - 2}
          </span>
        ) : null}
        {required ? (
          <span
            className="tag tone"
            style={toneStyle(REQUIRED_TONE)}
            title={p.apps.filter((a) => a.required && a.model).map((a) => `Requires ${a.app} ${a.model}`).join(" · ")}
          >
            <Cpu weight="bold" size={11} />
            {required.model}
          </span>
        ) : null}
        <div className="grow" />
        {p.parentId ? <GitFork weight="bold" size={15} className="muted" aria-label="Forked" /> : null}
        {p.visibility === "private" ? (
          <LockSimple size={16} className="muted" aria-label="Private" />
        ) : null}
        <FavoriteButton promptId={p.id} favorited={p.favoritedBy.includes(meId)} />
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

function WorkflowCard({ prompt: p, forks, meId, catalog }: { prompt: Prompt; forks: number; meId: string; catalog: Catalog }) {
  const w = p.workflow;
  const parts = [`updated ${ago(p.updatedAt)}`, forks ? plural(forks, "adaptation") : null];
  // Same badge budget as prompts and skills: kind, two integrations, "+N". Trigger, stage,
  // origin and customer-ready live in the filters and on the detail page.
  return (
    <article className={styles.card}>
      <div className={styles.cardTags}>
        <ApprovalTag approval={p.approval} short />
        <WorkflowTag />
        {w.integrations.slice(0, 2).map((i) => (
          <IntegrationTag key={i} name={i} color={catalogIntegration(catalog, i)?.color} />
        ))}
        {w.integrations.length > 2 ? (
          <span className="tag tag-light tag-muted" title={w.integrations.slice(2).join(", ")}>
            +{w.integrations.length - 2}
          </span>
        ) : null}
        <div className="grow" />
        {p.parentId ? <GitFork weight="bold" size={15} className="muted" aria-label="Adaptation" /> : null}
        {p.visibility === "private" ? <LockSimple size={16} className="muted" aria-label="Private" /> : null}
        <FavoriteButton promptId={p.id} favorited={p.favoritedBy.includes(meId)} />
      </div>
      <div className={styles.cardBody}>
        <h2 className={styles.cardTitle}>
          <Link href={`/prompts/${p.id}`} className={styles.cardLink}>
            {p.title}
          </Link>
        </h2>
        {p.parentId && p.forkNote ? (
          <p className={`${styles.cardDesc} clamp-2`}>
            <GitFork weight="bold" size={12} /> Adapted for <strong style={{ color: "var(--fg)" }}>{p.forkNote}</strong>
          </p>
        ) : (
          <p className={`${styles.cardDesc} clamp-2`}>{p.description}</p>
        )}
      </div>
      <div className={styles.cardFoot}>
        <Avatar person={p.owner} size={26} />
        <div className={styles.owner}>
          <span className={`${styles.ownerName} truncate`}>{p.owner.name}</span>
          <span className={styles.ownerMeta}>{parts.filter(Boolean).join(" · ")}</span>
        </div>
        <VoteButton promptId={p.id} count={p.upvoteUserIds.length} voted={p.upvoteUserIds.includes(meId)} />
      </div>
    </article>
  );
}
