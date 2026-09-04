"use client";

import {
  ArrowLeft,
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
import { useMemo, useState, useTransition } from "react";
import { createPrompt, deletePrompt, updatePrompt } from "@/app/actions";
import {
  ALLOWED_EMAIL_DOMAIN,
  APP_COLORS,
  APPS,
  AUDIENCES,
  SKILL_TEMPLATE,
  SURFACES,
  type App,
  type Audience,
  type Visibility,
} from "@/lib/constants";
import { personFromEmail } from "@/lib/people";
import { parsePlaceholders } from "@/lib/placeholders";
import { isArchiveName, isSkillMd, parseFrontmatter, titleFromSlug } from "@/lib/skills";
import type { Person, PromptApp, PromptDraft, SkillFile } from "@/lib/types";
import { unzip } from "@/lib/zip";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";
import { useToast } from "./Toast";
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
}

const VIS_OPTIONS: { k: Visibility; label: string; sub: string; Icon: typeof LockSimple }[] = [
  { k: "public", label: "Public", sub: "Everyone at Clay can find and fork it", Icon: GlobeHemisphereWest },
  { k: "private", label: "Private", sub: "Only you and your editors", Icon: LockSimple },
];

const UPLOAD_ACCEPT = ".skill,.zip,.md,.txt,.json,.yaml,.yml,.js,.py,.csv";

export function PromptEditor({
  mode,
  initial,
  promptId,
  parentTitle,
  owner,
  me,
  people,
  cancelHref,
}: Props) {
  const [d, setD] = useState<PromptDraft>(initial);
  const [fileIdx, setFileIdx] = useState(0);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const upd = (patch: Partial<PromptDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const isSkill = d.kind === "skill";
  const noun = isSkill ? "skill" : "prompt";
  const keys = useMemo(() => parsePlaceholders(d.body), [d.body]);
  const isOwner = owner.id === me.id;
  const hasUrl = d.links.some((l) => l.url.trim());
  const valid =
    d.title.trim().length > 0 &&
    (isSkill ? d.files.length > 0 || hasUrl : d.body.trim().length > 0) &&
    d.apps.length > 0;
  const hint = valid
    ? ""
    : !d.apps.length
      ? "Pick at least one tool."
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
  const toggleApp = (a: App) => {
    const has = d.apps.some((x) => x.app === a);
    upd({ apps: has ? d.apps.filter((x) => x.app !== a) : [...d.apps, { app: a, surfaces: [] }] });
  };
  const setSurface = (a: App, surf: string | null) => {
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

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!list.length) return;
    const archives = list.filter((f) => isArchiveName(f.name)).length;
    try {
      const groups = await Promise.all(
        list.map((f) =>
          isArchiveName(f.name)
            ? f.arrayBuffer().then(unzip)
            : f.text().then((content) => [{ name: f.name, content }]),
        ),
      );
      const added = groups.flat();
      if (!added.length) {
        show("No files found in that archive");
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
          if (fm.name && !cur.title.trim()) patch.title = titleFromSlug(fm.name);
          if (fm.description && !cur.description.trim()) patch.description = fm.description;
        }
        const idx = Math.max(merged.findIndex((x) => isSkillMd(x.name)), 0);
        setFileIdx(idx);
        return { ...cur, ...patch, files: merged };
      });
      show(
        archives
          ? `Unpacked ${added.length} file${added.length === 1 ? "" : "s"} from .skill`
          : `Added ${added.length} file${added.length === 1 ? "" : "s"}`,
      );
    } catch {
      show("Could not read that file");
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
      const res =
        mode === "edit" && promptId
          ? await updatePrompt(promptId, d)
          : await createPrompt(d, mode === "fork" ? promptId ?? null : null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const toast = mode === "edit" ? "saved" : mode === "fork" ? "forked" : isSkill ? "published-skill" : "published";
      router.push(`/prompts/${res.data.id}?toast=${toast}`);
    });
  };

  const remove = () => {
    if (!promptId || pending) return;
    if (!window.confirm(`Delete this ${noun}? Forks stay, but lose their link to it.`)) return;
    start(async () => {
      const res = await deletePrompt(promptId);
      if (!res.ok) return setError(res.error);
      router.push("/mine?toast=deleted");
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
                  <span className="tiny muted">
                    {d.files.length} file{d.files.length === 1 ? "" : "s"}
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
                      >
                        <FileText size={14} />
                        {f.name || "untitled"}
                      </button>
                    ))}
                    <div className="grow" />
                    <button type="button" className="btn btn-outline btn-sm" onClick={addFile}>
                      <Plus weight="bold" size={13} />
                      Add file
                    </button>
                    <label className={skillStyles.uploadLabel}>
                      <UploadSimple weight="bold" size={13} />
                      Upload .skill or files
                      <input
                        type="file"
                        multiple
                        accept={UPLOAD_ACCEPT}
                        onChange={onUpload}
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
                      <textarea
                        className={skillStyles.fileEditor}
                        rows={18}
                        spellCheck={false}
                        value={curFile.content}
                        onChange={(e) => setFile({ content: e.target.value })}
                        aria-label={`Contents of ${curFile.name}`}
                      />
                    </>
                  ) : (
                    <div className={skillStyles.noFiles}>
                      No files. Fine if this skill lives at a link below, or add a file to share it as a
                      .skill.
                    </div>
                  )}
                </div>
                <span className="tiny muted">
                  Upload a .skill file and it unpacks into its files here, filling in the title and
                  description from SKILL.md. Or start from the template: name and description in the
                  frontmatter, then the steps.
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
                {APPS.map((a) => (
                  <Chip
                    key={a}
                    label={a}
                    size="lg"
                    selected={d.apps.some((x) => x.app === a)}
                    tone={APP_COLORS[a]}
                    onClick={() => toggleApp(a)}
                  />
                ))}
              </div>
              {d.apps.filter((x) => SURFACES[x.app]).length ? (
                <div className={styles.surfaceGroups}>
                  {d.apps
                    .filter((x) => SURFACES[x.app])
                    .map((x) => (
                      <div key={x.app} className={styles.surfaceGroup}>
                        <span className="eyebrow">{x.app} surface</span>
                        <div className={styles.chips}>
                          <Chip
                            label="Any"
                            selected={x.surfaces.length === 0}
                            tone={APP_COLORS[x.app]}
                            onClick={() => setSurface(x.app, null)}
                          />
                          {SURFACES[x.app]!.map((s) => (
                            <Chip
                              key={s}
                              label={s}
                              selected={x.surfaces.includes(s)}
                              tone={APP_COLORS[x.app]}
                              onClick={() => setSurface(x.app, s)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>

            <div className={styles.group}>
              <span className="eyebrow">Audience</span>
              <div className={styles.chips}>
                {AUDIENCES.map((a: Audience) => (
                  <Chip
                    key={a}
                    label={a}
                    size="lg"
                    selected={d.audience === a}
                    onClick={() => upd({ audience: a })}
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
          {mode === "edit" && isOwner ? (
            <>
              <div className="grow" />
              <button type="button" className={styles.deleteBtn} onClick={remove} disabled={pending}>
                Delete {noun}
              </button>
            </>
          ) : null}
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
