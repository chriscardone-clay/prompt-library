"use client";

import { ArrowDown, ArrowUp, Plus, Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addMaintainer,
  deleteIntegration,
  reorderIntegrations,
  removeMaintainer,
  saveIntegration,
} from "@/app/admin/integrations/actions";
import type { CatalogIntegration } from "@/lib/catalog";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { plural } from "@/lib/format";
import { useToast } from "./Toast";
import styles from "./IntegrationsPanel.module.css";

interface Props {
  integrations: CatalogIntegration[];
  /** Workflows using each name, listed or not. */
  usage: Record<string, number>;
  /** Maintainer emails; null when the viewer isn't an admin. */
  maintainers: string[] | null;
}

const DEFAULT_COLOR = "#D1CDC7";

/** The Integrations catalog: maintained by the Workflows team, used by the workflow editor and filters. */
export function IntegrationsPanel({ integrations, usage, maintainers }: Props) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ name: "", color: DEFAULT_COLOR });
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [invite, setInvite] = useState("");
  const router = useRouter();
  const { show } = useToast();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return show(r.error ?? "Something went wrong");
      after?.();
      if (okMsg) show(okMsg);
      router.refresh();
    });

  const listed = new Set(integrations.map((i) => i.name.toLowerCase()));
  const unlisted = Object.entries(usage)
    .filter(([name]) => !listed.has(name.toLowerCase()))
    .sort((a, b) => b[1] - a[1]);
  const active = integrations.filter((i) => !i.archived);
  const archived = integrations.filter((i) => i.archived);

  const move = (name: string, dir: -1 | 1) => {
    const names = active.map((i) => i.name);
    const at = names.indexOf(name);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= names.length) return;
    [names[at], names[to]] = [names[to], names[at]];
    run(() => reorderIntegrations([...names, ...archived.map((i) => i.name)]));
  };

  const row = (i: CatalogIntegration, idx: number) => {
    const used = usage[i.name] ?? 0;
    const isRenaming = renaming?.from === i.name;
    return (
      <div key={i.name} className={styles.row} data-archived={i.archived ? "" : undefined}>
        <input
          type="color"
          className={styles.swatch}
          value={i.color}
          aria-label={`Colour for ${i.name}`}
          onChange={(e) => run(() => saveIntegration({ originalName: i.name, name: i.name, color: e.target.value, archived: i.archived }))}
        />
        {isRenaming ? (
          <form
            className={styles.renameForm}
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => saveIntegration({ originalName: i.name, name: renaming.to, color: i.color, archived: i.archived }),
                used ? `Renamed. ${plural(used, "workflow")} updated.` : "Renamed",
                () => setRenaming(null),
              );
            }}
          >
            <input
              className="input"
              value={renaming.to}
              onChange={(e) => setRenaming({ from: i.name, to: e.target.value })}
              maxLength={40}
              autoFocus
              aria-label={`New name for ${i.name}`}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              Save
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRenaming(null)}>
              Cancel
            </button>
            {used ? <span className="tiny muted">Updates {plural(used, "workflow")}</span> : null}
          </form>
        ) : (
          <span className={styles.name}>{i.name}</span>
        )}
        <span className={`tiny muted ${styles.used}`}>{used ? plural(used, "workflow") : "Not used yet"}</span>
        <div className={styles.actions}>
          {!i.archived ? (
            <>
              <button type="button" className="icon-btn" aria-label={`Move ${i.name} up`} disabled={pending || idx === 0} onClick={() => move(i.name, -1)}>
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${i.name} down`}
                disabled={pending || idx === active.length - 1}
                onClick={() => move(i.name, 1)}
              >
                <ArrowDown size={15} />
              </button>
            </>
          ) : null}
          {!isRenaming ? (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRenaming({ from: i.name, to: i.name })}>
              Rename
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={pending}
            onClick={() => run(() => saveIntegration({ originalName: i.name, name: i.name, color: i.color, archived: !i.archived }), i.archived ? "Restored" : "Archived")}
          >
            {i.archived ? "Restore" : "Archive"}
          </button>
          {used === 0 ? (
            <button type="button" className="icon-btn" aria-label={`Delete ${i.name}`} disabled={pending} onClick={() => run(() => deleteIntegration(i.name), "Deleted")}>
              <Trash size={15} />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <section className={styles.section}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="eyebrow">Workflows</span>
        <h1 className="display-lg">Integrations</h1>
        <p className="muted" style={{ maxWidth: "64ch" }}>
          The list the workflow editor offers and Discover filters by. Maintained by the Workflows team. Renaming updates every workflow
          that uses the name; anything in use can be archived but not deleted.
        </p>
      </div>

      <form
        className={styles.add}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveIntegration({ name: draft.name, color: draft.color }), `Added ${draft.name.trim()}`, () =>
            setDraft({ name: "", color: DEFAULT_COLOR }),
          );
        }}
      >
        <input
          type="color"
          className={styles.swatch}
          value={draft.color}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          aria-label="Colour for the new integration"
        />
        <input
          className="input"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Pipedrive"
          maxLength={40}
          aria-label="New integration name"
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !draft.name.trim()}>
          <Plus weight="bold" size={14} />
          Add integration
        </button>
      </form>

      <div className="slab" style={{ gap: 4 }}>
        {active.length ? active.map(row) : <span className="muted small">No integrations yet. Add the first one above.</span>}
      </div>

      {unlisted.length ? (
        <div className="slab" style={{ gap: 10 }}>
          <div className="section-title">In use but not on the list</div>
          <span className="small muted">Typed in by people creating workflows. Add the ones worth keeping so everyone uses the same name.</span>
          {unlisted.map(([name, n]) => (
            <div key={name} className={styles.row}>
              <span className={styles.name}>{name}</span>
              <span className={`tiny muted ${styles.used}`}>{plural(n, "workflow")}</span>
              <div className={styles.actions}>
                <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => saveIntegration({ name, color: DEFAULT_COLOR }), `Added ${name}`)}>
                  Add to the list
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {archived.length ? (
        <div className="slab" style={{ gap: 4 }}>
          <div className="section-title">Archived</div>
          <span className="small muted">Hidden from the editor and filters; still shown on workflows that use them.</span>
          {archived.map(row)}
        </div>
      ) : null}

      {maintainers ? (
        <div className="slab" style={{ gap: 12 }}>
          <div className="section-title">Workflow maintainers</div>
          <span className="small muted">These people can edit this list, and nothing else in admin. Only admins see this section.</span>
          <div className="stack" style={{ gap: 6 }}>
            {maintainers.length ? (
              maintainers.map((m) => (
                <div key={m} className={styles.row}>
                  <span className={styles.name}>{m}</span>
                  <div className={styles.actions}>
                    <button type="button" className="icon-btn" aria-label={`Remove ${m}`} disabled={pending} onClick={() => run(() => removeMaintainer(m), "Removed")}>
                      <X size={15} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <span className="small muted">No maintainers yet.</span>
            )}
          </div>
          <form
            className={styles.add}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addMaintainer(invite), `Added ${invite.trim()}`, () => setInvite(""));
            }}
          >
            <input
              className="input"
              type="email"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
              aria-label="Add a maintainer by email"
            />
            <button type="submit" className="btn btn-primary" disabled={pending || !invite.trim()}>
              Add maintainer
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
