"use client";

import {
  ArrowLeft,
  Cube,
  FileText,
  GitFork,
  GlobeHemisphereWest,
  Link as LinkIcon,
  LockSimple,
  Plus,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPrompt, updatePrompt } from "@/app/actions";
import { activeApps, activeTeams, appTone, surfacesOf, type Catalog } from "@/lib/catalog";
import {
  ALLOWED_EMAIL_DOMAIN,
  MAX_SKILL_BYTES,
  MAX_SKILL_TEXT_BYTES,
  SKILL_TEMPLATE,
  type Visibility,
} from "@/lib/constants";
import { personFromEmail } from "@/lib/people";
import { parsePlaceholders } from "@/lib/placeholders";
import {
  fileBytes,
  formatBytes,
  isArchiveName,
  isSkillMd,
  parseFrontmatter,
  skillTitleFrom,
} from "@/lib/skills";
import { uploadSkillBinary } from "@/lib/supabase/storage";
import { isBinaryFile, type Person, type PromptApp, type PromptDraft, type SkillFile } from "@/lib/types";
import { isBinaryName, looksBinary, unzip } from "@/lib/zip";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";
import { useToast } from "./Toast";
import { UploadQueue, type QueueItem } from "./UploadQueue";
import styles from "./PromptEditor.module.css";
import skillStyles from "./Skill.module.css";

export type EditorMode = "create" | "edit" | "fork";

interface Props {
  mode: EditorMode;
  initial: PromptDraft;
  /** Prompt being edited (edit) or forked (fork). */
  promptId?: string;
  parentTitle?: string;
  owner: Person;
  me: Person;
  /** Known people for editor rows (so invited teammates show their real name/avatar). */
  people: Person[];
  cancelHref: string;
  catalog: Catalog;
}

const VIS_OPTIONS: { k: Visibility; label: string; sub: string; Icon: typeof LockSimple }[] = [
  { k: "public", label: "Public", sub: "Everyone at Clay can find and fork it", Icon: GlobeHemisphereWest },
  { k: "private", label: "Private", sub: "Only you and your editors", Icon: LockSimple },
];

export function PromptEditor({
  mode,
  initial,
  promptId,
  parentTitle,
  owner,
  me,
  people,
  cancelHref,
  catalog,
}: Props) {
  const [d, setD] = useState<PromptDraft>(initial);
  const [fileIdx, setFileIdx] = useState(0);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploading = queue.some((i) => i.status !== "done" && i.status !== "failed")
    ? "Adding files… publish is available once they finish."
    : null;
  const [pending, start] = useTransition();
  // The row's id is fixed up front so binary uploads can land in its storage
  // folder before the row exists. Editing reuses the real id.
  const [draftId] = useState(() => (mode === "edit" && promptId ? promptId : crypto.randomUUID()));
  const router = useRouter();
  const { show } = useToast();

  const upd = (patch: Partial<PromptDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const isSkill = d.kind === "skill";
  const noun = isSkill ? "skill" : "prompt";
  const keys = useMemo(() => parsePlaceholders(d.body), [d.body]);
  const isOwner = owner.id === me.id;
  const hasUrl = d.links.some((l) => l.url.trim());
  const textBytes = d.files.reduce((n, f) => n + (isBinaryFile(f) ? 0 : fileBytes(f)), 0);
  const totalBytes = d.files.reduce((n, f) => n + fileBytes(f), 0);
  const overLimit = isSkill && (totalBytes > MAX_SKILL_BYTES || textBytes > MAX_SKILL_TEXT_BYTES);
  const valid =
    d.title.trim().length > 0 &&
    (isSkill ? d.files.length > 0 || hasUrl : d.body.trim().length > 0) &&
    d.apps.length > 0 &&
    d.audiences.length > 0 &&
    !overLimit &&
    !uploading;
  const hint = valid
    ? ""
    : uploading
      ? uploading
      : overLimit
        ? totalBytes > MAX_SKILL_BYTES
          ? `The skill totals ${formatBytes(totalBytes)}; the limit is ${formatBytes(MAX_SKILL_BYTES)}. Remove some files.`
          : `Text files total ${formatBytes(textBytes)}; the limit is ${formatBytes(MAX_SKILL_TEXT_BYTES)}. Trim or remove some.`
      : !d.apps.length
        ? "Pick at least one tool."
        : !d.audiences.length
          ? "Pick at least one audience."
          : isSkill
            ? "Add a title and at least one file or link."
            : "Add a title and a prompt to continue.";

  const peopleByEmail = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of people) m.set(p.email.toLowerCase(), p);
    m.set(owner.email.toLowerCase(), owner);
    m.set(me.email.toLowerCase(), me);
    return m;
  }, [people, owner, me]);

  // ── Apps ──────────────────────────────────────────────────────────
  const toggleApp = (a: string) => {
    const has = d.apps.some((x) => x.app === a);
    upd({ apps: has ? d.apps.filter((x) => x.app !== a) : [...d.apps, { app: a, surfaces: [] }] });
  };
  const setSurface = (a: string, surf: string | null) => {
    upd({
      apps: d.apps.map((x): PromptApp => {
        if (x.app !== a) return x;
        if (surf === null) return { app: a, surfaces: [] };
        return {
          app: a,
          surfaces: x.surfaces.includes(surf)
            ? x.surfaces.filter((s) => s !== surf)
            : [...x.surfaces, surf],
        };
      }),
    });
  };

  // ── Skill files ───────────────────────────────────────────────────
  const curIdx = Math.min(fileIdx, Math.max(d.files.length - 1, 0));
  const curFile = d.files[curIdx];
  const setFile = (patch: Partial<SkillFile>) =>
    upd({ files: d.files.map((f, i) => (i === curIdx ? { ...f, ...patch } : f)) });
  const addFile = () => {
    upd({ files: [...d.files, { name: "reference.md", content: "" }] });
    setFileIdx(d.files.length);
  };
  const removeFile = () => {
    upd({ files: d.files.filter((_, i) => i !== curIdx) });
    setFileIdx(Math.max(curIdx - 1, 0));
  };

  // Keep the finished queue on screen briefly, then clear it.
  useEffect(() => {
    if (!queue.length || uploading) return;
    queueTimer.current = setTimeout(() => setQueue([]), 2500);
    return () => {
      if (queueTimer.current) clearTimeout(queueTimer.current);
    };
  }, [queue, uploading]);

  const patchQueue = (id: string, patch: Partial<QueueItem>) =>
    setQueue((q) => q.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length || uploading) return;
    const archives = list.filter((f) => isArchiveName(f.name)).length;
    if (queueTimer.current) clearTimeout(queueTimer.current);

    // One row per picked file; archives expand into their entries as they're read.
    let seq = 0;
    const nextId = () => `q${Date.now()}-${seq++}`;
    const initial: QueueItem[] = list.map((f) => ({
      id: nextId(),
      name: f.name,
      size: f.size,
      kind: isArchiveName(f.name) ? "archive" : isBinaryName(f.name) ? "binary" : "text",
      status: "queued",
      progress: 0,
    }));
    setQueue(initial);

    try {
      // Phase 1: read everything. Text stays inline; binaries are queued for storage.
      const texts: SkillFile[] = [];
      const binaries: { qid: string; name: string; bytes: Uint8Array; type?: string }[] = [];
      for (let k = 0; k < list.length; k++) {
        const f = list[k];
        const row = initial[k];
        patchQueue(row.id, { status: "reading" });
        // Let the row paint before a potentially long read.
        await new Promise((r) => setTimeout(r, 30));
        if (isArchiveName(f.name)) {
          const r = await unzip(await f.arrayBuffer());
          const entries: QueueItem[] = [
            ...r.texts.map((t) => ({ id: nextId(), name: t.name, size: fileBytes({ name: t.name, content: t.content }), kind: "text" as const, status: "done" as const, progress: 1 })),
            ...r.binaries.map((b) => ({ id: nextId(), name: b.name, size: b.bytes.length, kind: "binary" as const, status: "queued" as const, progress: 0 })),
          ];
          texts.push(...r.texts.map((t) => ({ name: t.name, content: t.content })));
          r.binaries.forEach((b, j) => binaries.push({ qid: entries[r.texts.length + j].id, name: b.name, bytes: b.bytes }));
          // Replace the archive row with its contents.
          setQueue((q) => q.flatMap((i) => (i.id === row.id ? entries : [i])));
        } else {
          const bytes = new Uint8Array(await f.arrayBuffer());
          if (isBinaryName(f.name) || looksBinary(bytes)) {
            binaries.push({ qid: row.id, name: f.name, bytes, type: f.type || undefined });
            patchQueue(row.id, { status: "queued", kind: "binary", size: bytes.length });
          } else {
            texts.push({ name: f.name, content: new TextDecoder().decode(bytes) });
            patchQueue(row.id, { status: "done", kind: "text", progress: 1 });
          }
        }
      }
      if (!texts.length && !binaries.length) {
        setQueue([]);
        show("No files found in that archive");
        return;
      }
      const incoming = binaries.reduce((n, b) => n + b.bytes.length, 0) + texts.reduce((n, t) => n + fileBytes(t), 0);
      if (totalBytes + incoming > MAX_SKILL_BYTES) {
        setQueue([]);
        show(`That would make the skill ${formatBytes(totalBytes + incoming)}; the limit is ${formatBytes(MAX_SKILL_BYTES)}.`);
        return;
      }

      // Phase 2: upload binaries one at a time with byte progress.
      const stored: SkillFile[] = [];
      const failures: string[] = [];
      for (const b of binaries) {
        patchQueue(b.qid, { status: "uploading", progress: 0 });
        try {
          const path = await uploadSkillBinary(draftId, b.name, b.bytes, b.type, (p) => patchQueue(b.qid, { progress: p }));
          const entry: SkillFile = { name: b.name, content: "", path, size: b.bytes.length };
          if (b.type) entry.type = b.type;
          stored.push(entry);
          patchQueue(b.qid, { status: "done", progress: 1 });
        } catch (err) {
          const msg = err instanceof Error && err.message ? err.message : "Upload failed";
          failures.push(b.name);
          patchQueue(b.qid, { status: "failed", error: msg });
        }
      }
      const added: SkillFile[] = [...texts, ...stored];
      if (!added.length) {
        show("Nothing was added: every upload failed. Try again.");
        return;
      }
      setD((cur) => {
        // An untouched template gets replaced by an uploaded bundle, not merged into it.
        const isTemplate =
          cur.files.length === 1 && isSkillMd(cur.files[0].name) && cur.files[0].content === SKILL_TEMPLATE;
        const base = isTemplate && archives ? [] : cur.files;
        const merged = [
          ...base.filter((x) => !added.some((a) => a.name.toLowerCase() === x.name.toLowerCase())),
          ...added,
        ];
        const md = added.find((x) => isSkillMd(x.name));
        const patch: Partial<PromptDraft> = {};
        if (md) {
          const fm = parseFrontmatter(md.content);
          const title = skillTitleFrom(md.content);
          if (title && !cur.title.trim()) patch.title = title;
          if (fm.description && !cur.description.trim()) patch.description = fm.description;
        }
        const idx = Math.max(merged.findIndex((x) => isSkillMd(x.name)), 0);
        setFileIdx(idx);
        return { ...cur, ...patch, files: merged };
      });
      const n = added.length;
      const base = archives ? `Unpacked ${n} file${n === 1 ? "" : "s"} from .skill` : `Added ${n} file${n === 1 ? "" : "s"}`;
      show(failures.length ? `${base}. ${failures.length} upload${failures.length === 1 ? "" : "s"} failed.` : base);
    } catch (err) {
      setQueue([]);
      show(err instanceof Error && err.message ? `Upload failed: ${err.message}` : "Could not read that file");
    }
  };

  // ── Skill links ───────────────────────────────────────────────────
  const setLink = (i: number, patch: Partial<{ label: string; url: string }>) =>
    upd({ links: d.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const addLink = () => upd({ links: [...d.links, { label: "", url: "" }] });
  const removeLink = (i: number) => upd({ links: d.links.filter((_, j) => j !== i) });

  // ── Editors ───────────────────────────────────────────────────────
  const addEditor = () => {
    const email = invite.trim().toLowerCase();
    if (!email) return;
    if (!email.includes("@")) return setError("Enter a full email address.");
    if (!email.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
      return setError(`Editors need an @${ALLOWED_EMAIL_DOMAIN} address.`);
    }
    setError(null);
    if (email === owner.email.toLowerCase() || d.editors.includes(email)) {
      setInvite("");
      return;
    }
    upd({ editors: [...d.editors, email] });
    setInvite("");
    show(`Invited ${(peopleByEmail.get(email) ?? personFromEmail(email)).name}`);
  };

  // ── Save / delete ─────────────────────────────────────────────────
  const save = () => {
    if (!valid || pending) return;
    setError(null);
    start(async () => {
      try {
        const res =
          mode === "edit" && promptId
            ? await updatePrompt(promptId, d)
            : await createPrompt(d, mode === "fork" ? promptId ?? null : null, draftId);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const toast = mode === "edit" ? "saved" : mode === "fork" ? "forked" : isSkill ? "published-skill" : "published";
        router.push(`/prompts/${res.data.id}?toast=${toast}`);
      } catch {
        // A thrown action (network, payload too large) shouldn't take down the page.
        setError(
          isSkill
            ? "Couldn't save. The skill may be too large to send; remove some files and try again."
            : "Couldn't save. Check your connection and try again.",
        );
      }
    });
  };

  const heading = mode === "create" ? `New ${noun}` : mode === "edit" ? `Edit ${noun}` : `Fork ${noun}`;
  const saveLabel = mode === "edit" ? "Save changes" : mode === "fork" ? "Create fork" : `Publish ${noun}`;

  return (
    <section className={styles.section}>
      <Link href={cancelHref} className="back-link">
        <ArrowLeft weight="bold" size={13} />
        Cancel
      </Link>
      <div className={styles.titleBlock}>
        <h1 className="display-md">{heading}</h1>
        {mode === "fork" ? (
          <div className={styles.forkLine}>
            <GitFork weight="bold" size={14} />
            <span>
              Forking <span className={styles.forkParent}>{parentTitle}</span>. Your version stays
              linked to the original.
            </span>
          </div>
        ) : null}
      </div>

      <form
        className={styles.columns}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className={styles.main}>
          <label className="field">
            <span className="eyebrow">Title</span>
            <input
              className={`input ${styles.titleInput}`}
              value={d.title}
              onChange={(e) => upd({ title: e.target.value })}
              placeholder={isSkill ? "e.g. Clay formulas" : "e.g. Account research brief"}
              maxLength={200}
              required
            />
          </label>
          <label className="field">
            <span className="eyebrow">Description</span>
            <input
              className="input"
              style={{ padding: "11px 14px" }}
              value={d.description}
              onChange={(e) => upd({ description: e.target.value })}
              placeholder="One sentence on what it does and when to use it"
              maxLength={600}
            />
          </label>
          {mode === "fork" ? (
            <label className="field">
              <span className="eyebrow">What did you change?</span>
              <input
                className="input"
                style={{ padding: "11px 14px" }}
                value={d.forkNote}
                onChange={(e) => upd({ forkNote: e.target.value })}
                placeholder="e.g. Added a competitor section, cut it to 5 bullets"
                maxLength={600}
              />
              <span className="tiny muted">
                Shown on the original so others can see how your variant differs.
              </span>
            </label>
          ) : null}

          {isSkill ? (
            <>
              {/* ── Files ── */}
              <div className="field">
                <div className={styles.bodyHead}>
                  <span className="eyebrow">Files</span>
                  <span className={`tiny ${overLimit ? styles.error : "muted"}`}>
                    {d.files.length} file{d.files.length === 1 ? "" : "s"}
                    {d.files.length ? ` · ${formatBytes(totalBytes)} of ${formatBytes(MAX_SKILL_BYTES)}` : ""}
                  </span>
                </div>
                <div className={skillStyles.editorFiles}>
                  <div className={skillStyles.editorFileBar}>
                    {d.files.map((f, i) => (
                      <button
                        key={i}
                        type="button"
                        className={skillStyles.fileTab}
                        aria-pressed={i === curIdx}
                        onClick={() => setFileIdx(i)}
                        title={isBinaryFile(f) ? `${f.name} · ${formatBytes(f.size ?? 0)}` : undefined}
                      >
                        {isBinaryFile(f) ? <Cube size={14} /> : <FileText size={14} />}
                        {f.name || "untitled"}
                      </button>
                    ))}
                    <div className="grow" />
                    <button type="button" className="btn btn-outline btn-sm" onClick={addFile}>
                      <Plus weight="bold" size={13} />
                      Add file
                    </button>
                    <label className={skillStyles.uploadLabel} aria-disabled={!!uploading} data-busy={uploading ? "" : undefined}>
                      {uploading ? <span className={skillStyles.btnSpinner} aria-hidden="true" /> : <UploadSimple weight="bold" size={13} />}
                      {uploading ? "Adding files…" : "Upload .skill or files"}
                      <input
                        type="file"
                        multiple
                        onChange={onUpload}
                        disabled={!!uploading}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                  {curFile ? (
                    <>
                      <div className={skillStyles.editorFileMeta}>
                        <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>
                          File name
                        </span>
                        <input
                          className={skillStyles.fileNameInput}
                          value={curFile.name}
                          onChange={(e) => setFile({ name: e.target.value })}
                          aria-label="File name"
                        />
                        <button type="button" className={skillStyles.removeBtn} onClick={removeFile}>
                          <Trash size={14} />
                          Remove
                        </button>
                      </div>
                      {isBinaryFile(curFile) ? (
                        <div className={skillStyles.binaryView}>
                          <Cube size={28} className="muted" />
                          <div className="stack" style={{ gap: 4 }}>
                            <div style={{ fontWeight: 500 }}>{curFile.name.split("/").pop()}</div>
                            <div className="small muted">
                              Binary file · {formatBytes(curFile.size ?? 0)}
                              {curFile.type ? ` · ${curFile.type}` : ""}. Stored as-is and included in the
                              .skill download.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <textarea
                          className={skillStyles.fileEditor}
                          rows={18}
                          spellCheck={false}
                          value={curFile.content}
                          onChange={(e) => setFile({ content: e.target.value })}
                          aria-label={`Contents of ${curFile.name}`}
                        />
                      )}
                    </>
                  ) : (
                    <div className={skillStyles.noFiles}>
                      No files. Fine if this skill lives at a link below, or add a file to share it as a
                      .skill.
                    </div>
                  )}
                </div>
                {queue.length ? <UploadQueue items={queue} /> : null}
                <span className="tiny muted">
                  Upload a .skill file and it unpacks into its files here, filling in the title and
                  description from SKILL.md. Text files are editable; fonts, images and other binaries
                  are stored as-is. Up to {formatBytes(MAX_SKILL_BYTES)} per skill.
                </span>
              </div>

              {/* ── Links ── */}
              <div className="field">
                <div className={styles.bodyHead}>
                  <span className="eyebrow">Links</span>
                  <span className="tiny muted">
                    {d.links.length ? `${d.links.length} link${d.links.length === 1 ? "" : "s"}` : "Optional"}
                  </span>
                </div>
                <div className="stack gap-2">
                  {d.links.map((l, i) => (
                    <div key={i} className={skillStyles.linkRow}>
                      <input
                        className={`input ${skillStyles.linkLabelInput}`}
                        value={l.label}
                        onChange={(e) => setLink(i, { label: e.target.value })}
                        placeholder="Label, e.g. Claude project"
                        aria-label="Link label"
                      />
                      <input
                        className={`input ${skillStyles.linkUrlInput}`}
                        value={l.url}
                        onChange={(e) => setLink(i, { url: e.target.value })}
                        placeholder="https://"
                        inputMode="url"
                        aria-label="Link URL"
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remove link"
                        onClick={() => removeLink(i)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ alignSelf: "flex-start" }}
                    onClick={addLink}
                  >
                    <LinkIcon weight="bold" size={13} />
                    Add link
                  </button>
                </div>
                <span className="tiny muted">
                  Where this skill lives in its home app: a Claude project or skill share link, a custom
                  GPT, a Town agent. Label is optional.
                </span>
              </div>
            </>
          ) : (
            <div className="field">
              <div className={styles.bodyHead}>
                <span className="eyebrow">Prompt</span>
                <span className="tiny muted">
                  Wrap placeholders in <code className={styles.code}>{"{{company}}"}</code>
                </span>
              </div>
              <textarea
                className="textarea"
                rows={14}
                value={d.body}
                onChange={(e) => upd({ body: e.target.value })}
                placeholder="You are a senior GTM researcher at Clay. Write a brief on {{company}} for a call with a {{persona}}…"
                style={{ fontSize: 14.5, lineHeight: 1.6, padding: "14px 16px" }}
                required
              />
              <div className={styles.phRow}>
                <span className="tiny muted" style={{ marginRight: 4 }}>
                  {keys.length
                    ? `${keys.length} placeholder${keys.length === 1 ? "" : "s"} detected:`
                    : "No placeholders yet."}
                </span>
                {keys.map((k) => (
                  <span key={k} className={styles.phPill}>
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          <label className="field">
            <div className={styles.bodyHead}>
              <span className="eyebrow">How to use</span>
              <span className="tiny muted">Optional. Shown under the {noun}, not copied with it.</span>
            </div>
            <textarea
              className="textarea"
              rows={5}
              value={d.notes}
              onChange={(e) => upd({ notes: e.target.value })}
              placeholder={"When to use it, tips, connectors it needs. Start a line with \"- \" for a bullet."}
              maxLength={5000}
            />
          </label>
        </div>

        <div className={styles.side}>
          <div className={styles.slab} style={{ gap: 18 }}>
            <div className={styles.group}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Built for</span>
                <span className="tiny muted">Pick every tool this works in.</span>
              </div>
              <div className={styles.chips}>
                {[
                  ...activeApps(catalog).map((a) => a.name),
                  // Keep an archived app visible while it's still selected on this item.
                  ...d.apps.map((x) => x.app).filter((n) => !activeApps(catalog).some((a) => a.name === n)),
                ].map((a) => (
                  <Chip
                    key={a}
                    label={a}
                    size="lg"
                    selected={d.apps.some((x) => x.app === a)}
                    tone={appTone(catalog, a)}
                    onClick={() => toggleApp(a)}
                  />
                ))}
              </div>
              {d.apps.filter((x) => surfacesOf(catalog, x.app).length).length ? (
                <div className={styles.surfaceGroups}>
                  {d.apps
                    .filter((x) => surfacesOf(catalog, x.app).length)
                    .map((x) => {
                      const tone = appTone(catalog, x.app);
                      const pill = (label: string, on: boolean, onClick: () => void) => (
                        <button
                          key={label}
                          type="button"
                          className={styles.surfacePill}
                          aria-pressed={on}
                          onClick={onClick}
                          style={{ ["--pill-fg" as string]: tone.fg }}
                        >
                          {label}
                        </button>
                      );
                      return (
                        <div key={x.app} className={styles.surfaceGroup} style={{ background: tone.bg, color: tone.fg }}>
                          <div className={styles.surfaceHead}>
                            <span className="eyebrow" style={{ color: tone.fg }}>
                              {x.app}
                            </span>
                            <span className={styles.surfaceHint}>
                              {x.surfaces.length ? `Works in ${x.surfaces.join(", ")}` : `Works anywhere in ${x.app}`}
                            </span>
                          </div>
                          <div className={styles.surfacePills}>
                            {pill("Anywhere", x.surfaces.length === 0, () => setSurface(x.app, null))}
                            {surfacesOf(catalog, x.app).map((s) => pill(s, x.surfaces.includes(s), () => setSurface(x.app, s)))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>

            <div className={styles.group}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Audience</span>
                <span className="tiny muted">Pick every team this is for.</span>
              </div>
              <div className={styles.chips}>
                {[
                  ...activeTeams(catalog).map((t) => t.name),
                  ...d.audiences.filter((n) => !activeTeams(catalog).some((t) => t.name === n)),
                ].map((a) => (
                  <Chip
                    key={a}
                    label={a}
                    size="lg"
                    selected={d.audiences.includes(a)}
                    onClick={() =>
                      upd({
                        audiences: d.audiences.includes(a)
                          ? d.audiences.filter((x) => x !== a)
                          : [...d.audiences, a],
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div className={styles.group}>
              <span className="eyebrow">Visibility</span>
              <div className="stack" style={{ gap: 6 }}>
                {VIS_OPTIONS.map(({ k, label, sub, Icon }) => (
                  <button
                    key={k}
                    type="button"
                    className={styles.visOption}
                    aria-pressed={d.visibility === k}
                    onClick={() => upd({ visibility: k })}
                  >
                    <Icon size={18} className="muted" />
                    <div className="stack" style={{ gap: 2 }}>
                      <span className={styles.visLabel}>{label}</span>
                      <span className="tiny muted">{sub}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.slab}>
            <div className="stack" style={{ gap: 4 }}>
              <span className="eyebrow">Editors</span>
              <span className="tiny muted">
                Editors can change the {noun} and resolve feedback. Anyone can fork.
              </span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <EditorRow person={owner} role="Owner" />
              {d.editors.map((email) => {
                const p = peopleByEmail.get(email) ?? personFromEmail(email);
                const removable = isOwner || mode !== "edit" || !initial.editors.includes(email);
                return (
                  <EditorRow
                    key={email}
                    person={p}
                    role={p.id ? "Editor" : "Editor · invited"}
                    onRemove={
                      removable ? () => upd({ editors: d.editors.filter((e) => e !== email) }) : undefined
                    }
                  />
                );
              })}
            </div>
            <div className={styles.inviteRow}>
              <input
                className={styles.inviteInput}
                type="email"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEditor();
                  }
                }}
                placeholder={`name@${ALLOWED_EMAIL_DOMAIN}`}
                aria-label="Invite an editor by email"
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={addEditor}>
                Invite
              </button>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!valid || pending}>
            {pending ? "Saving…" : saveLabel}
          </button>
          <Link href={cancelHref} className="btn btn-outline btn-lg">
            Cancel
          </Link>
          <span className={`tiny ${error ? styles.error : "muted"}`} role={error ? "alert" : undefined}>
            {error ?? hint}
          </span>
        </div>
      </form>
    </section>
  );
}

function EditorRow({
  person,
  role,
  onRemove,
}: {
  person: Person;
  role: string;
  onRemove?: () => void;
}) {
  return (
    <div className={styles.editorRow}>
      <Avatar person={person} size={26} />
      <div className={styles.editorText}>
        <span className={styles.editorName}>{person.name}</span>
        <span className="tiny muted">{role}</span>
      </div>
      {onRemove ? (
        <button type="button" className="icon-btn" aria-label={`Remove ${person.name}`} onClick={onRemove}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}
