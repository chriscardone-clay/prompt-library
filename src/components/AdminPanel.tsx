"use client";

import { ArrowDown, ArrowUp, Check, Plus, Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  addAdmin,
  deleteApp,
  deleteSurface,
  deleteTeam,
  removeAdmin,
  reorder,
  saveApp,
  saveSurface,
  saveTeam,
} from "@/app/admin/actions";
import type { ActionResult } from "@/app/actions";
import { FALLBACK_TONE, toneStyle, type Catalog, type CatalogApp, type CatalogSurface, type CatalogTeam } from "@/lib/catalog";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { useToast } from "./Toast";
import styles from "./AdminPanel.module.css";

interface Usage {
  apps: Record<string, number>;
  surfaces: Record<string, number>;
  teams: Record<string, number>;
}

interface Props {
  catalog: Catalog;
  usage: Usage;
  admins: string[];
  meEmail: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function AdminPanel({ catalog, usage, admins, meEmail }: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, start] = useTransition();

  /** Run an action, toast the outcome, and refresh server data on success. */
  const run = (label: string, fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        show(res.error);
        return;
      }
      show(label);
      after?.();
      router.refresh();
    });

  const move = (kind: "apps" | "teams" | "surfaces", names: string[], i: number, dir: -1 | 1, scope?: string) => {
    const j = i + dir;
    if (j < 0 || j >= names.length) return;
    const next = [...names];
    [next[i], next[j]] = [next[j], next[i]];
    run("Order saved", () => reorder(kind, next, scope));
  };

  return (
    <section className={styles.section}>
      <div className={styles.titleStack}>
        <div className="eyebrow-lg">Admin</div>
        <h1 className="display-lg">Manage the catalog</h1>
        <p className={styles.lede}>
          Apps, their surfaces, and teams are data. Renaming cascades into every item that uses the old
          name. Something in use can be archived (hidden from pickers and filters) but not deleted.
        </p>
      </div>

      {/* ── Apps ── */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className="section-title">Apps</h2>
          <span className="tiny muted">Pick colours for light mode: a 100 tint for the background and a 400 shade for text (aim for 4.5:1 contrast). Dark mode derives its own pair from the text colour.</span>
        </div>
        <div className={styles.list}>
          {catalog.apps.map((app, i) => (
            <AppRow
              key={app.name}
              app={app}
              used={usage.apps[app.name] ?? 0}
              surfaceUsage={usage.surfaces}
              pending={pending}
              onSave={(input) => run("App saved", () => saveApp(input))}
              onDelete={() => run("App deleted", () => deleteApp(app.name))}
              onMove={(dir) => move("apps", catalog.apps.map((a) => a.name), i, dir)}
              onSaveSurface={(s) => run("Surface saved", () => saveSurface({ app: app.name, ...s }))}
              onDeleteSurface={(name) => run("Surface deleted", () => deleteSurface(app.name, name))}
              onMoveSurface={(idx, dir) =>
                move("surfaces", app.surfaces.map((s) => s.name), idx, dir, app.name)
              }
              first={i === 0}
              last={i === catalog.apps.length - 1}
            />
          ))}
        </div>
        <NewApp pending={pending} onAdd={(input) => run("App added", () => saveApp(input))} />
      </div>

      {/* ── Teams ── */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className="section-title">Teams</h2>
          <span className="tiny muted">Shown as the Team filter and the Audience picker.</span>
        </div>
        <div className={styles.list}>
          {catalog.teams.map((t, i) => (
            <TeamRow
              key={t.name}
              team={t}
              used={usage.teams[t.name] ?? 0}
              pending={pending}
              onSave={(input) => run("Team saved", () => saveTeam(input))}
              onDelete={() => run("Team deleted", () => deleteTeam(t.name))}
              onMove={(dir) => move("teams", catalog.teams.map((x) => x.name), i, dir)}
              first={i === 0}
              last={i === catalog.teams.length - 1}
            />
          ))}
        </div>
        <InlineAdd
          placeholder="New team, e.g. Marketing"
          pending={pending}
          onAdd={(name) => run("Team added", () => saveTeam({ name, archived: false }))}
        />
      </div>

      {/* ── Admins ── */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <h2 className="section-title">Admins</h2>
          <span className="tiny muted">Who sees this page. You can't remove yourself.</span>
        </div>
        <div className={styles.list}>
          {admins.map((email) => (
            <div key={email} className={styles.row}>
              <span className={styles.grow}>{email}</span>
              {email === meEmail ? (
                <span className="tiny muted">you</span>
              ) : (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${email}`}
                  disabled={pending}
                  onClick={() => run("Admin removed", () => removeAdmin(email))}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        <InlineAdd
          placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
          type="email"
          pending={pending}
          onAdd={(email) => run("Admin added", () => addAdmin(email))}
        />
      </div>
    </section>
  );
}

// ── App row ─────────────────────────────────────────────────────────
function AppRow({
  app,
  used,
  surfaceUsage,
  pending,
  onSave,
  onDelete,
  onMove,
  onSaveSurface,
  onDeleteSurface,
  onMoveSurface,
  first,
  last,
}: {
  app: CatalogApp;
  used: number;
  surfaceUsage: Record<string, number>;
  pending: boolean;
  onSave: (input: { originalName: string; name: string; bg: string; fg: string; install: string; archived: boolean }) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onSaveSurface: (s: { originalName?: string; name: string; install: string }) => void;
  onDeleteSurface: (name: string) => void;
  onMoveSurface: (idx: number, dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const [draft, setDraft] = useState({ name: app.name, bg: app.bg, fg: app.fg, install: app.install, archived: app.archived });
  useEffect(() => setDraft({ name: app.name, bg: app.bg, fg: app.fg, install: app.install, archived: app.archived }), [app]);
  const dirty =
    draft.name !== app.name ||
    draft.bg.toUpperCase() !== app.bg.toUpperCase() ||
    draft.fg.toUpperCase() !== app.fg.toUpperCase() ||
    draft.install !== app.install ||
    draft.archived !== app.archived;
  const validHex = HEX.test(draft.bg) && HEX.test(draft.fg);

  return (
    <div className={`${styles.card} ${app.archived ? styles.archived : ""}`}>
      <div className={styles.cardRow}>
        <span className="tag tone" style={toneStyle(validHex ? draft : app)}>
          {draft.name || "App"}
        </span>
        <input
          className={`input ${styles.nameInput}`}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          aria-label="App name"
          maxLength={40}
        />
        <ColourField label="Bg" value={draft.bg} onChange={(v) => setDraft({ ...draft, bg: v })} />
        <ColourField label="Text" value={draft.fg} onChange={(v) => setDraft({ ...draft, fg: v })} />
        <label className={styles.check}>
          <input type="checkbox" checked={draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.checked })} />
          Archived
        </label>
        <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>
          {used ? `used by ${used}` : "unused"}
        </span>
        <div className={styles.rowActions}>
          <button type="button" className="icon-btn" aria-label="Move up" disabled={first || pending} onClick={() => onMove(-1)}>
            <ArrowUp size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Move down" disabled={last || pending} onClick={() => onMove(1)}>
            <ArrowDown size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete app"
            title={used ? "In use: archive it instead" : "Delete"}
            disabled={pending || used > 0}
            onClick={onDelete}
          >
            <Trash size={15} />
          </button>
        </div>
      </div>
      <label className="field">
        <span className="eyebrow">Install instructions</span>
        <textarea
          className="textarea"
          rows={2}
          value={draft.install}
          onChange={(e) => setDraft({ ...draft, install: e.target.value })}
          placeholder="How to install a skill's files in this app"
          maxLength={600}
          style={{ fontSize: 13.5 }}
        />
      </label>

      <div className={styles.surfaces}>
        <span className="eyebrow">Surfaces</span>
        {app.surfaces.length ? (
          app.surfaces.map((s, i) => (
            <SurfaceRow
              key={s.name}
              surface={s}
              used={surfaceUsage[`${app.name} · ${s.name}`] ?? 0}
              pending={pending}
              onSave={(input) => onSaveSurface({ originalName: s.name, ...input })}
              onDelete={() => onDeleteSurface(s.name)}
              onMove={(dir) => onMoveSurface(i, dir)}
              first={i === 0}
              last={i === app.surfaces.length - 1}
            />
          ))
        ) : (
          <span className="tiny muted">No surfaces. Items just say “{app.name}”.</span>
        )}
        <InlineAdd
          placeholder={`New surface for ${app.name}, e.g. Chat`}
          pending={pending}
          onAdd={(name) => onSaveSurface({ name, install: "" })}
          compact
        />
      </div>

      {dirty ? (
        <div className={styles.saveRow}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={pending || !validHex || !draft.name.trim()}
            onClick={() => onSave({ originalName: app.name, ...draft })}
          >
            <Check weight="bold" size={13} />
            Save {draft.name !== app.name ? "and rename" : "changes"}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm on-slab"
            disabled={pending}
            onClick={() => setDraft({ name: app.name, bg: app.bg, fg: app.fg, install: app.install, archived: app.archived })}
          >
            Discard
          </button>
          {draft.name !== app.name && used ? (
            <span className="tiny muted">Renaming updates {used} item{used === 1 ? "" : "s"}.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SurfaceRow({
  surface,
  used,
  pending,
  onSave,
  onDelete,
  onMove,
  first,
  last,
}: {
  surface: CatalogSurface;
  used: number;
  pending: boolean;
  onSave: (input: { name: string; install: string }) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const [draft, setDraft] = useState({ name: surface.name, install: surface.install });
  useEffect(() => setDraft({ name: surface.name, install: surface.install }), [surface]);
  const dirty = draft.name !== surface.name || draft.install !== surface.install;
  return (
    <div className={styles.surfaceRow}>
      <input
        className={`input ${styles.surfaceName}`}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        aria-label="Surface name"
        maxLength={40}
      />
      <input
        className={`input ${styles.grow}`}
        value={draft.install}
        onChange={(e) => setDraft({ ...draft, install: e.target.value })}
        placeholder="Install instructions for this surface (optional)"
        aria-label="Surface install instructions"
        maxLength={600}
      />
      <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>
        {used ? `used by ${used}` : "unused"}
      </span>
      <div className={styles.rowActions}>
        {dirty ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending || !draft.name.trim()} onClick={() => onSave(draft)}>
            Save
          </button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Move up" disabled={first || pending} onClick={() => onMove(-1)}>
          <ArrowUp size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="Move down" disabled={last || pending} onClick={() => onMove(1)}>
          <ArrowDown size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Delete surface"
          title={used ? "In use: remove it from those items first" : "Delete"}
          disabled={pending || used > 0}
          onClick={onDelete}
        >
          <Trash size={15} />
        </button>
      </div>
    </div>
  );
}

function NewApp({ pending, onAdd }: { pending: boolean; onAdd: (input: { name: string; bg: string; fg: string; install: string; archived: boolean }) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", bg: "#F4F3F0", fg: "#1B1A18", install: "" });
  const validHex = HEX.test(draft.bg) && HEX.test(draft.fg);
  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        <Plus weight="bold" size={13} />
        Add app
      </button>
    );
  }
  return (
    <div className={styles.card}>
      <div className={styles.cardRow}>
        <span className="tag tone" style={toneStyle(validHex ? draft : FALLBACK_TONE)}>
          {draft.name || "New app"}
        </span>
        <input
          className={`input ${styles.nameInput}`}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Name, e.g. Gemini"
          aria-label="New app name"
          maxLength={40}
          autoFocus
        />
        <ColourField label="Bg" value={draft.bg} onChange={(v) => setDraft({ ...draft, bg: v })} />
        <ColourField label="Text" value={draft.fg} onChange={(v) => setDraft({ ...draft, fg: v })} />
      </div>
      <label className="field">
        <span className="eyebrow">Install instructions</span>
        <textarea
          className="textarea"
          rows={2}
          value={draft.install}
          onChange={(e) => setDraft({ ...draft, install: e.target.value })}
          placeholder="How to install a skill's files in this app"
          maxLength={600}
          style={{ fontSize: 13.5 }}
        />
      </label>
      <div className={styles.saveRow}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || !validHex || !draft.name.trim()}
          onClick={() => {
            onAdd({ ...draft, archived: false });
            setDraft({ name: "", bg: "#F4F3F0", fg: "#1B1A18", install: "" });
            setOpen(false);
          }}
        >
          <Plus weight="bold" size={13} />
          Add app
        </button>
        <button type="button" className="btn btn-outline btn-sm on-slab" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TeamRow({
  team,
  used,
  pending,
  onSave,
  onDelete,
  onMove,
  first,
  last,
}: {
  team: CatalogTeam;
  used: number;
  pending: boolean;
  onSave: (input: { originalName: string; name: string; archived: boolean }) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const [draft, setDraft] = useState({ name: team.name, archived: team.archived });
  useEffect(() => setDraft({ name: team.name, archived: team.archived }), [team]);
  const dirty = draft.name !== team.name || draft.archived !== team.archived;
  return (
    <div className={`${styles.row} ${team.archived ? styles.archived : ""}`}>
      <span className="tag tag-light">{draft.name || "Team"}</span>
      <input
        className={`input ${styles.nameInput}`}
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        aria-label="Team name"
        maxLength={40}
      />
      <label className={styles.check}>
        <input type="checkbox" checked={draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.checked })} />
        Archived
      </label>
      <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>
        {used ? `used by ${used}` : "unused"}
      </span>
      <div className={styles.rowActions}>
        {dirty ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pending || !draft.name.trim()}
              onClick={() => onSave({ originalName: team.name, ...draft })}
            >
              Save
            </button>
            <button type="button" className="btn btn-outline btn-sm on-slab" disabled={pending} onClick={() => setDraft({ name: team.name, archived: team.archived })}>
              Discard
            </button>
          </>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Move up" disabled={first || pending} onClick={() => onMove(-1)}>
          <ArrowUp size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label="Move down" disabled={last || pending} onClick={() => onMove(1)}>
          <ArrowDown size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Delete team"
          title={used ? "In use: archive it instead" : "Delete"}
          disabled={pending || used > 0}
          onClick={onDelete}
        >
          <Trash size={15} />
        </button>
      </div>
    </div>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = HEX.test(value);
  return (
    <label className={styles.colour} title={`${label} colour`}>
      <span className="eyebrow">{label}</span>
      <input type="color" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={`${label} colour picker`} />
      <input
        className={`input ${styles.hex} ${valid ? "" : styles.invalid}`}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        aria-label={`${label} colour hex`}
        maxLength={7}
        spellCheck={false}
      />
    </label>
  );
}

function InlineAdd({
  placeholder,
  pending,
  onAdd,
  type = "text",
  compact,
}: {
  placeholder: string;
  pending: boolean;
  onAdd: (value: string) => void;
  type?: string;
  compact?: boolean;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue("");
  };
  return (
    <div className={`${styles.addRow} ${compact ? styles.addRowCompact : ""}`}>
      <input
        className={`input ${styles.grow}`}
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={type === "email" ? 120 : 40}
      />
      <button type="button" className="btn btn-primary btn-sm" disabled={pending || !value.trim()} onClick={submit}>
        <Plus weight="bold" size={13} />
        Add
      </button>
    </div>
  );
}
