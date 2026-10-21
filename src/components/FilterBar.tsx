"use client";

import { CaretDown, Check, MagnifyingGlass, SlidersHorizontal, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./FilterBar.module.css";

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
  /** Small colour square (integration colour). */
  swatch?: string;
  /** Extra controls under the option while it's selected (an app's surfaces). */
  children?: ReactNode;
}

export interface Facet {
  key: string;
  label: string;
  options: FacetOption[];
  selected: string[];
  /** One value at a time (picking another replaces it). */
  single?: boolean;
  toggle: (value: string) => void;
  clear: () => void;
}

interface Props {
  facets: Facet[];
  /** "14 items", shown after the chips and on the popovers' button. */
  resultLabel: string;
  onClearAll: () => void;
}

const SEARCH_FROM = 7;
/** Room kept for "+N more" when some chips don't fit. */
const MORE_WIDTH = 120;
const GAP = 8;

function summary(f: Facet): string {
  const names = f.selected.map((v) => f.options.find((o) => o.value === v)?.label ?? v);
  return names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(", ");
}

/**
 * One line of facet chips. Applied facets come first so they never hide;
 * whatever doesn't fit folds into "+N more", which opens All filters with
 * every facet listed. The row never wraps.
 */
export function FilterBar({ facets, resultLabel, onClearAll }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [fit, setFit] = useState(facets.length);
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);

  const anyActive = facets.some((f) => f.selected.length);
  // Applied first, then the given order.
  const ordered = useMemo(() => [...facets.filter((f) => f.selected.length), ...facets.filter((f) => !f.selected.length)], [facets]);
  const orderKey = ordered.map((f) => `${f.key}:${f.selected.join("|")}`).join(",");

  useLayoutEffect(() => {
    const el = row.current;
    const m = measure.current;
    if (!el || !m) return;
    const compute = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth);
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const room = inner - (tail.current?.offsetWidth ?? 0) - GAP;
      const total = widths.reduce((a, w) => a + w + GAP, 0);
      if (total <= room) return setFit(widths.length);
      // Not everything fits: keep room for "+N more" and take chips in order while they fit.
      const budget = room - MORE_WIDTH - GAP;
      let used = 0;
      let n = 0;
      while (n < widths.length && used + widths[n] <= budget) used += widths[n++] + GAP;
      setFit(n);
    };
    compute();
    // Chip widths change as fonts load and values change; the row changes with the window.
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    ro.observe(m);
    if (tail.current) ro.observe(tail.current);
    document.fonts?.ready.then(compute).catch(() => {});
    return () => ro.disconnect();
  }, [orderKey, resultLabel, anyActive]);

  // Close on outside click / Escape.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Popovers near the right edge open leftwards so they stay on screen.
  const [alignEnd, setAlignEnd] = useState(false);
  const openAt = (key: string, el: HTMLElement) => {
    const box = wrap.current?.getBoundingClientRect();
    const at = el.getBoundingClientRect();
    setAlignEnd(!!box && at.left + (key === "__all" ? 440 : 300) > box.right);
    setOpen(open === key ? null : key);
  };

  const visible = ordered.slice(0, fit);
  const hidden = ordered.slice(fit);
  const hiddenActive = hidden.filter((f) => f.selected.length).length;

  return (
    <div ref={wrap} className={styles.wrap}>
      {/* Off-screen copy of every chip, to measure what fits. */}
      <div ref={measure} className={styles.measure} aria-hidden="true">
        {ordered.map((f) => (
          <Chip key={f.key} facet={f} open={false} onOpen={() => {}} />
        ))}
      </div>

      <div ref={row} className={styles.row} role="toolbar" aria-label="Filters">
        {visible.map((f) => (
          <div key={f.key} className={styles.anchor} data-end={open === f.key && alignEnd ? "" : undefined}>
            <Chip facet={f} open={open === f.key} onOpen={(el) => openAt(f.key, el)} />
            {open === f.key ? <FacetPopover facet={f} resultLabel={resultLabel} onDone={() => setOpen(null)} /> : null}
          </div>
        ))}
        {hidden.length ? (
          <div className={styles.anchor} data-end={open === "__all" && alignEnd ? "" : undefined}>
            <button
              type="button"
              className={styles.chip}
              data-more=""
              aria-haspopup="dialog"
              aria-expanded={open === "__all"}
              onClick={(e) => openAt("__all", e.currentTarget)}
            >
              <SlidersHorizontal weight="bold" size={13} />+{hidden.length} more
              {hiddenActive ? <span className={styles.value}>· {hiddenActive} active</span> : null}
            </button>
            {open === "__all" ? <AllFilters facets={ordered} firstHidden={hidden[0].key} resultLabel={resultLabel} onClearAll={onClearAll} onDone={() => setOpen(null)} /> : null}
          </div>
        ) : null}
        <div ref={tail} className={styles.tail}>
          <span className={styles.sep} aria-hidden="true" />
          <span className="small muted">{resultLabel}</span>
          {anyActive ? (
            <button type="button" className={styles.clearAll} onClick={onClearAll}>
              Clear all
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Chip({ facet: f, open, onOpen }: { facet: Facet; open: boolean; onOpen: (el: HTMLElement) => void }) {
  const on = f.selected.length > 0;
  return (
    <span className={styles.chipWrap} data-on={on ? "" : undefined}>
      <button type="button" className={styles.chip} data-on={on ? "" : undefined} data-open={open ? "" : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={(e) => onOpen(e.currentTarget)}>
        {f.label}
        {on ? <span className={styles.value}>{summary(f)}</span> : <CaretDown weight="bold" size={11} />}
      </button>
      {on ? (
        <button type="button" className={styles.chipX} aria-label={`Clear ${f.label}`} onClick={f.clear}>
          <X weight="bold" size={10} />
        </button>
      ) : null}
    </span>
  );
}

function Options({ facet: f, query }: { facet: Facet; query: string }) {
  const q = query.trim().toLowerCase();
  const shown = f.options.filter((o) => !q || o.label.toLowerCase().includes(q));
  if (!shown.length) return <div className={styles.none}>Nothing matches “{query}”.</div>;
  return (
    <ul className={styles.options} role="listbox" aria-multiselectable={!f.single} aria-label={f.label}>
      {shown.map((o) => {
        const on = f.selected.includes(o.value);
        return (
          <li key={o.value}>
            <button type="button" role="option" aria-selected={on} className={styles.option} onClick={() => f.toggle(o.value)}>
              <span className={styles.box} data-round={f.single ? "" : undefined}>
                {on ? <Check weight="bold" size={11} /> : null}
              </span>
              {o.swatch ? <span className={styles.swatch} style={{ background: o.swatch }} aria-hidden="true" /> : null}
              <span className="grow">{o.label}</span>
              {o.count !== undefined ? <span className={styles.count}>{o.count}</span> : null}
            </button>
            {on && o.children ? <div className={styles.sub}>{o.children}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function FacetPopover({ facet: f, resultLabel, onDone }: { facet: Facet; resultLabel: string; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const searchable = f.options.length >= SEARCH_FROM;
  return (
    <div className={styles.popover} role="dialog" aria-label={f.label}>
      {searchable ? (
        <label className={styles.search}>
          <MagnifyingGlass size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${f.options.length} ${f.label.toLowerCase()}`} autoFocus />
        </label>
      ) : null}
      <Options facet={f} query={query} />
      <div className={styles.foot}>
        <button type="button" className={styles.clearAll} onClick={f.clear} disabled={!f.selected.length}>
          Clear
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>
          Show {resultLabel}
        </button>
      </div>
    </div>
  );
}

/** Every facet in one place: what it's set to, with its options inline. Opens on the first one that didn't fit. */
function AllFilters({ facets, firstHidden, resultLabel, onClearAll, onDone }: { facets: Facet[]; firstHidden: string; resultLabel: string; onClearAll: () => void; onDone: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(firstHidden);
  const active = facets.filter((f) => f.selected.length).length;
  return (
    <div className={`${styles.popover} ${styles.all}`} role="dialog" aria-label="All filters">
      <div className={styles.allHead}>
        <strong className="grow">All filters</strong>
        <span className="tiny muted">
          {facets.length} · {active} active
        </span>
      </div>
      <div className={styles.allList}>
        {facets.map((f) => (
          <div key={f.key} className={styles.allItem}>
            <button type="button" className={styles.allRow} aria-expanded={expanded === f.key} onClick={() => setExpanded(expanded === f.key ? null : f.key)}>
              <span className={styles.allKey}>{f.label}</span>
              <span className={styles.allVal} data-on={f.selected.length ? "" : undefined}>
                {f.selected.length ? summary(f) : "Any"}
              </span>
              <CaretDown weight="bold" size={12} style={{ transform: expanded === f.key ? "rotate(180deg)" : undefined }} />
            </button>
            {expanded === f.key ? <AllOptions facet={f} /> : null}
          </div>
        ))}
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.clearAll} onClick={onClearAll} disabled={!active}>
          Clear all
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>
          Show {resultLabel}
        </button>
      </div>
    </div>
  );
}

function AllOptions({ facet: f }: { facet: Facet }) {
  const [query, setQuery] = useState("");
  return (
    <div className={styles.allOpen}>
      {f.options.length >= SEARCH_FROM ? (
        <label className={styles.search}>
          <MagnifyingGlass size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${f.label.toLowerCase()}`} />
        </label>
      ) : null}
      <Options facet={f} query={query} />
    </div>
  );
}
