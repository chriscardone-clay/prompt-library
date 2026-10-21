"use client";

import { CaretDown, Check, MagnifyingGlass, SlidersHorizontal, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
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

export interface TextField {
  key: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}

interface Props {
  facets: Facet[];
  /** Text matched against one field each (title, description, contents). Lives in the drawer only. */
  textFields?: TextField[];
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
 * The filter bar: a Filters button that always sits at the left and opens
 * every filter in a drawer from the left edge (a bottom sheet on phones),
 * then one line of facet chips in a fixed order. Chips never move; whatever
 * doesn't fit folds into "+N more", which opens the same drawer.
 */
export function FilterBar({ facets, textFields = [], resultLabel, onClearAll }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | null | false>(false);
  const [fit, setFit] = useState(facets.length);
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);

  const activeFacets = facets.filter((f) => f.selected.length).length;
  const activeText = textFields.filter((t) => t.value.trim()).length;
  const activeTotal = activeFacets + activeText;
  const layoutKey = facets.map((f) => `${f.key}:${f.selected.join("|")}`).join(",");

  useLayoutEffect(() => {
    const el = row.current;
    const m = measure.current;
    if (!el || !m) return;
    const compute = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth);
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const room = inner - (lead.current?.offsetWidth ?? 0) - GAP - (tail.current?.offsetWidth ?? 0) - GAP;
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
    for (const n of [el, m, lead.current, tail.current]) if (n) ro.observe(n);
    document.fonts?.ready.then(compute).catch(() => {});
    return () => ro.disconnect();
  }, [layoutKey, resultLabel, activeTotal]);

  // Close a chip's popover on outside click / Escape.
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
    setAlignEnd(!!box && el.getBoundingClientRect().left + 300 > box.right);
    setOpen(open === key ? null : key);
  };
  const openDrawer = (focus: string | null) => {
    setOpen(null);
    setDrawer(focus);
  };

  const visible = facets.slice(0, fit);
  const hidden = facets.slice(fit);
  const hiddenActive = hidden.filter((f) => f.selected.length).length;

  return (
    <div ref={wrap} className={styles.wrap}>
      {/* Hidden copy of every chip, to measure what fits. Clipped so it can't widen the page. */}
      <div className={styles.measureClip} aria-hidden="true">
        <div ref={measure} className={styles.measure}>
          {facets.map((f) => (
            <Chip key={f.key} facet={f} open={false} onOpen={() => {}} />
          ))}
        </div>
      </div>

      <div ref={row} className={styles.row} role="toolbar" aria-label="Filters">
        <div ref={lead} className={styles.lead}>
          <button type="button" className={styles.filtersBtn} aria-haspopup="dialog" aria-expanded={drawer !== false} onClick={() => openDrawer(null)}>
            <SlidersHorizontal weight="bold" size={14} />
            Filters
            {activeTotal ? <span className={styles.badge}>{activeTotal}</span> : null}
          </button>
          <span className={styles.sep} aria-hidden="true" />
        </div>
        {visible.map((f) => (
          <div key={f.key} className={styles.anchor} data-end={open === f.key && alignEnd ? "" : undefined}>
            <Chip facet={f} open={open === f.key} onOpen={(el) => openAt(f.key, el)} />
            {open === f.key ? <FacetPopover facet={f} resultLabel={resultLabel} onDone={() => setOpen(null)} /> : null}
          </div>
        ))}
        {hidden.length ? (
          <div className={styles.anchor}>
            <button type="button" className={styles.chip} data-more="" aria-haspopup="dialog" onClick={() => openDrawer(hidden[0].key)}>
              <SlidersHorizontal weight="bold" size={13} />+{hidden.length} more
              {hiddenActive ? <span className={styles.value}>· {hiddenActive} active</span> : null}
            </button>
          </div>
        ) : null}
        <div ref={tail} className={styles.tail}>
          <span className={styles.sep} aria-hidden="true" />
          <span className="small muted">{resultLabel}</span>
          {activeTotal ? (
            <button type="button" className={styles.clearAll} onClick={onClearAll}>
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      {drawer !== false ? (
        <FilterDrawer facets={facets} textFields={textFields} focus={drawer} activeTotal={activeTotal} resultLabel={resultLabel} onClearAll={onClearAll} onClose={() => setDrawer(false)} />
      ) : null}
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

/**
 * Every filter in one place, sliding in from the left edge (the side the bar
 * starts on). Text matching per field first, then each facet in the bar's order.
 */
function FilterDrawer({
  facets,
  textFields,
  focus,
  activeTotal,
  resultLabel,
  onClearAll,
  onClose,
}: {
  facets: Facet[];
  textFields: TextField[];
  focus: string | null;
  activeTotal: number;
  resultLabel: string;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(focus);
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    if (focus) item.current[focus]?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.drawerLayer}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="filters-title">
        <div className={styles.drawerHead}>
          <h2 id="filters-title" className={styles.drawerTitle}>
            Filters
          </h2>
          <span className="tiny muted grow">{activeTotal ? `${activeTotal} active` : ""}</span>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close filters" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          {textFields.length ? (
            <section className={styles.textSection} aria-labelledby="match-text">
              <span id="match-text" className="eyebrow">
                Match text
              </span>
              {textFields.map((t) => (
                <label key={t.key} className={styles.textField}>
                  <span>{t.label}</span>
                  <input className="input" value={t.value} placeholder={t.placeholder} onChange={(e) => t.onChange(e.target.value)} />
                </label>
              ))}
              <span className="tiny muted">Each field matches only itself. The search bar still searches everything.</span>
            </section>
          ) : null}
          {facets.map((f) => (
            <div key={f.key} ref={(el) => void (item.current[f.key] = el)} className={styles.allItem}>
              <button type="button" className={styles.allRow} aria-expanded={expanded === f.key} onClick={() => setExpanded(expanded === f.key ? null : f.key)}>
                <span className={styles.allKey}>{f.label}</span>
                <span className={styles.allVal} data-on={f.selected.length ? "" : undefined}>
                  {f.selected.length ? summary(f) : "Any"}
                </span>
                <CaretDown weight="bold" size={12} style={{ transform: expanded === f.key ? "rotate(180deg)" : undefined }} />
              </button>
              {expanded === f.key ? <DrawerOptions facet={f} /> : null}
            </div>
          ))}
        </div>
        <div className={styles.foot}>
          <button type="button" className={styles.clearAll} onClick={onClearAll} disabled={!activeTotal}>
            Clear all
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Show {resultLabel}
          </button>
        </div>
      </aside>
    </div>
  );
}

function DrawerOptions({ facet: f }: { facet: Facet }) {
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
