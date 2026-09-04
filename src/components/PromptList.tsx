"use client";

import { LockSimple, MagnifyingGlass } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
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
  type Sort,
} from "@/lib/constants";
import { ago, plural } from "@/lib/format";
import type { Profile, Prompt } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";
import { AppTag, AudienceTag, ForkTag } from "./Tag";
import { VoteButton } from "./VoteButton";
import styles from "./PromptList.module.css";

interface Props {
  view: "discover" | "mine";
  prompts: Prompt[];
  /** Used for fork counts on the My prompts view, where `prompts` is a subset. */
  allPrompts?: Prompt[];
  me: Profile;
}

export function PromptList({ view, prompts, allPrompts, me }: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const q = params.get("q") ?? "";
  const appParam = params.get("app") ?? "All";
  const app = isApp(appParam) ? appParam : "All";
  const surface = params.get("surface") ?? "All";
  const audParam = params.get("team") ?? "All";
  const aud = isAudience(audParam) ? audParam : "All";
  const sortParam = params.get("sort") ?? "top";
  const sort: Sort = isSort(sortParam) ? sortParam : "top";

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === "All" || (k === "sort" && v === "top")) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const forkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of allPrompts ?? prompts) {
      if (p.parentId) counts.set(p.parentId, (counts.get(p.parentId) ?? 0) + 1);
    }
    return counts;
  }, [allPrompts, prompts]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = prompts;
    if (app !== "All") {
      out = out.filter((p) =>
        p.apps.some(
          (a) =>
            a.app === app &&
            (surface === "All" || a.surfaces.length === 0 || a.surfaces.includes(surface)),
        ),
      );
    }
    if (aud !== "All") out = out.filter((p) => p.audience === aud);
    if (needle) {
      out = out.filter((p) =>
        `${p.title} ${p.description} ${p.body}`.toLowerCase().includes(needle),
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
  }, [prompts, q, app, surface, aud, sort]);

  const surfaces = app !== "All" ? SURFACES[app] : undefined;

  return (
    <section className={styles.section}>
      <div className={styles.titleRow}>
        <div className={styles.titleStack}>
          <h1 className="display-lg">{view === "mine" ? "My prompts" : "Discover prompts"}</h1>
          <div className="muted small">
            {plural(list.length, "prompt")}
            {view === "mine" ? " you own or edit" : ""}
          </div>
        </div>
        <div className={styles.sortGroup} role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.sortBtn}
              aria-pressed={sort === s}
              onClick={() => setParams({ sort: s })}
            >
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filters}>
        <label className={styles.search}>
          <MagnifyingGlass size={18} className="muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setParams({ q: e.target.value })}
            placeholder="Search prompts, descriptions, placeholders…"
            aria-label="Search prompts"
          />
        </label>
        <div className={styles.filterRows}>
          <div className={styles.filterRow}>
            <span className={`eyebrow ${styles.filterLabel}`}>App</span>
            <Chip
              label="All"
              selected={app === "All"}
              onClick={() => setParams({ app: null, surface: null })}
            />
            {APPS.map((a) => (
              <Chip
                key={a}
                label={a}
                selected={app === a}
                tone={APP_COLORS[a]}
                onClick={() => setParams({ app: a, surface: null })}
              />
            ))}
          </div>
          {surfaces && app !== "All" ? (
            <div className={styles.filterRow}>
              <span className={`eyebrow ${styles.filterLabel}`}>{app} surface</span>
              <Chip
                label="All"
                selected={surface === "All"}
                tone={APP_COLORS[app]}
                onClick={() => setParams({ surface: null })}
              />
              {surfaces.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  selected={surface === s}
                  tone={APP_COLORS[app]}
                  onClick={() => setParams({ surface: s })}
                />
              ))}
            </div>
          ) : null}
          <div className={styles.filterRow}>
            <span className={`eyebrow ${styles.filterLabel}`}>Team</span>
            <Chip label="All" selected={aud === "All"} onClick={() => setParams({ team: null })} />
            {AUDIENCES.map((a) => (
              <Chip key={a} label={a} selected={aud === a} onClick={() => setParams({ team: a })} />
            ))}
          </div>
        </div>
      </div>

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
            Clear a filter, or write the prompt your team keeps asking for.
          </div>
          <Link href="/prompts/new" className="btn btn-primary">
            New prompt
          </Link>
        </div>
      )}
    </section>
  );
}

function PromptCard({ prompt: p, forks, meId }: { prompt: Prompt; forks: number; meId: string }) {
  const meta = `updated ${ago(p.updatedAt)}${forks ? ` · ${plural(forks, "fork")}` : ""}`;
  return (
    <article className={styles.card}>
      <div className={styles.cardTags}>
        {p.apps.map((a) => (
          <AppTag key={a.app} app={a} />
        ))}
        <AudienceTag audience={p.audience} light />
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
