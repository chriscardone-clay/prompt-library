"use client";

import {
  ArrowLeft,
  CaretDown,
  CaretUp,
  CheckCircle,
  CheckSquare,
  Cube,
  FileText,
  GitFork,
  GlobeHemisphereWest,
  Link as LinkIcon,
  LockSimple,
  PencilSimple,
  Plus,
  Square,
  Trash,
  UploadSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPrompt, updatePrompt } from "@/app/actions";
import {
  activeApps,
  activeIntegrations,
  activeTeams,
  appTone,
  catalogIntegration,
  REQUIRED_TONE,
  surfacesOf,
  toneStyle,
  type Catalog,
} from "@/lib/catalog";
import {
  ALLOWED_EMAIL_DOMAIN,
  MAX_INTEGRATIONS,
  MAX_SKILL_BYTES,
  MAX_SKILL_TEXT_BYTES,
  MAX_WORKFLOW_ATTACHMENTS,
  MAX_WORKFLOW_DOC_BYTES,
  SKILL_TEMPLATE,
  STAGE_LABELS,
  SUGGESTED_INTEGRATIONS,
  TRIGGER_LABELS,
  WORKFLOW_STAGES,
  WORKFLOW_TEMPLATE,
  WORKFLOW_TRIGGERS,
  type Visibility,
  type WorkflowTrigger,
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
import {
  EMPTY_WORKFLOW,
  isBinaryFile,
  type Person,
  type PromptApp,
  type PromptDraft,
  type SkillFile,
  type WorkflowMeta,
} from "@/lib/types";
import {
  decodeExact,
  docFacts,
  docFileName,
  isMarkdownName,
  scanForInternal,
  suggestIntegrations,
  suggestTrigger,
  unpackDoc,
} from "@/lib/workflows";
import { isBinaryName, looksBinary, unzip } from "@/lib/zip";
import { Avatar } from "./Avatar";
import { useToast } from "./Toast";
import { UploadQueue, type QueueItem } from "./UploadQueue";
import styles from "./PromptEditor.module.css";
import skillStyles from "./Skill.module.css";

export type EditorMode = "create" | "edit" | "fork";
/** How a new skill arrives: pick a route first, then the form appears. */
type Route = "" | "upload" | "write" | "link" | "existing";
type Section = "" | "apps" | "auds" | "vis" | "team" | "ready";

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
  /** Workflows: live publish links, which unticking customer-ready revokes. */
  activeShares?: number;
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
  activeShares = 0,
}: Props) {
  // A workflow's .md arrives packed (see packDoc) so its bytes survive the trip.
  const [d, setD] = useState<PromptDraft>(() =>
    initial.kind === "workflow" && initial.files[0]
      ? { ...initial, files: [{ ...initial.files[0], content: unpackDoc(initial.files[0].content) }, ...initial.files.slice(1)] }
      : initial,
  );
  const [fileIdx, setFileIdx] = useState(0);
  // New skills and workflows start by choosing how they arrive; everything else has an "existing" route.
  const [route, setRoute] = useState<Route>(
    mode === "create" && (initial.kind === "skill" || initial.kind === "workflow") ? "" : "existing",
  );
  // The Details accordion opens one section at a time.
  const [openSec, setOpenSec] = useState<Section>("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploading = queue.some((i) => i.status !== "done" && i.status !== "failed")
    ? "Adding files… publish is available once they finish."
    : null;
  const [pending, start] = useTransition();
  const [dragging, setDragging] = useState(false);
  // The row's id is fixed up front so binary uploads can land in its storage
  // folder before the row exists. Editing reuses the real id.
  const [draftId] = useState(() => (mode === "edit" && promptId ? promptId : crypto.randomUUID()));
  const router = useRouter();
  const { show } = useToast();

  const upd = (patch: Partial<PromptDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const isSkill = d.kind === "skill";
  const isWf = d.kind === "workflow";
  const isPrompt = d.kind === "prompt";
  const noun = isSkill ? "skill" : isWf ? "workflow" : "prompt";

  // ── Workflow (.md + facts) ────────────────────────────────────────
  const wf = d.workflow ?? EMPTY_WORKFLOW;
  const setWf = (patch: Partial<WorkflowMeta>) =>
    setD((prev) => ({ ...prev, workflow: { ...(prev.workflow ?? EMPTY_WORKFLOW), ...patch } }));
  const doc = isWf ? d.files[0] : undefined;
  const docBytes = doc ? fileBytes(doc) : 0;
  const docTooBig = docBytes > MAX_WORKFLOW_DOC_BYTES;
  const docContent = doc?.content ?? "";
  const findings = useMemo(() => (isWf && docContent ? scanForInternal(docContent) : []), [isWf, docContent]);
  const [suggest, setSuggest] = useState<{ trigger: WorkflowTrigger | ""; integrations: string[] } | null>(null);
  const suggestLeft = !!suggest && (!!suggest.trigger || suggest.integrations.length > 0);
  const [intInput, setIntInput] = useState("");
  // The Workflows team's list; the starter list until the catalog has entries.
  const integrationNames = useMemo(() => {
    const listed = activeIntegrations(catalog).map((i) => i.name);
    return listed.length ? listed : [...SUGGESTED_INTEGRATIONS];
  }, [catalog]);
  const addIntegration = (raw: string) => {
    const typed = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!typed) return;
    const name = catalogIntegration(catalog, typed)?.name ?? typed;
    setD((prev) => {
      const cur = prev.workflow ?? EMPTY_WORKFLOW;
      if (cur.integrations.some((x) => x.toLowerCase() === name.toLowerCase()) || cur.integrations.length >= MAX_INTEGRATIONS) return prev;
      return { ...prev, workflow: { ...cur, integrations: [...cur.integrations, name] } };
    });
  };
  const removeIntegration = (name: string) => setWf({ integrations: wf.integrations.filter((x) => x !== name) });
  const setDoc = (patch: Partial<SkillFile>) => {
    if (!doc) return;
    upd({ files: [{ ...doc, ...patch }, ...d.files.slice(1)] });
  };
  const attachments = isWf ? d.files.slice(1) : [];
  const attBytes = attachments.reduce((n, f) => n + (f.size ?? 0), 0);
  const [attBusy, setAttBusy] = useState<string | null>(null);
  /** Attachments go straight to Storage under this workflow's folder, like binary skill files. */
  const addAttachments = async (list: File[]) => {
    if (!list.length || attBusy) return;
    let next = [...attachments];
    for (const f of list) {
      const name = f.name.split(/[/\\]/).pop()?.trim() || "file";
      if (doc && name.toLowerCase() === doc.name.toLowerCase()) {
        show(`${name} has the same name as the .md. Rename it first.`);
        continue;
      }
      const others = next.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
      if (others.length >= MAX_WORKFLOW_ATTACHMENTS) {
        show(`Up to ${MAX_WORKFLOW_ATTACHMENTS} attachments.`);
        break;
      }
      if (others.reduce((n, a) => n + (a.size ?? 0), 0) + f.size > MAX_SKILL_BYTES) {
        show(`Attachments can total ${formatBytes(MAX_SKILL_BYTES)}. ${name} doesn't fit.`);
        continue;
      }
      setAttBusy(`Uploading ${name}…`);
      try {
        const path = await uploadSkillBinary(draftId, name, f, f.type || undefined);
        const entry: SkillFile = { name, content: "", path, size: f.size };
        if (f.type) entry.type = f.type;
        next = [...others, entry];
        setD((cur) => ({ ...cur, files: [cur.files[0], ...next].filter(Boolean) }));
      } catch (err) {
        show(err instanceof Error && err.message ? `Couldn't upload ${name}: ${err.message}` : `Couldn't upload ${name}`);
      }
    }
    setAttBusy(null);
  };
  const removeAttachment = (name: string) =>
    setD((cur) => ({ ...cur, files: cur.files.filter((f, i) => i === 0 || f.name !== name) }));
  const keys = useMemo(() => parsePlaceholders(d.body), [d.body]);
  const isOwner = owner.id === me.id;
  const hasUrl = d.links.some((l) => l.url.trim());
  const textBytes = d.files.reduce((n, f) => n + (isBinaryFile(f) ? 0 : fileBytes(f)), 0);
  const totalBytes = d.files.reduce((n, f) => n + fileBytes(f), 0);
  const overLimit = isSkill && (totalBytes > MAX_SKILL_BYTES || textBytes > MAX_SKILL_TEXT_BYTES);
  const needsAdaptedFor = isWf && mode === "fork" && !d.forkNote.trim();
  const valid =
    d.title.trim().length > 0 &&
    (isSkill
      ? d.files.length > 0 || hasUrl
      : isWf
        ? !!docContent.trim() && !docTooBig && !needsAdaptedFor && !attBusy
        : d.body.trim().length > 0) &&
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
        ? "Pick at least one app."
        : !d.audiences.length
          ? "Pick at least one team."
          : isSkill
            ? "Add a title and at least one file or link."
            : isWf
              ? attBusy
                ? `${attBusy} Publish is available once it finishes.`
                : docTooBig
                ? `The .md is ${formatBytes(docBytes)}; the limit is ${formatBytes(MAX_WORKFLOW_DOC_BYTES)}.`
                : needsAdaptedFor
                  ? "Say what this adaptation is for."
                  : "Add a title and the workflow's .md."
              : "Add a title and a prompt to continue.";
  const readyHint = "Everything needed is filled in.";

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
    upd({ apps: has ? d.apps.filter((x) => x.app !== a) : [...d.apps, { app: a, surfaces: [], model: "", required: false }] });
  };
  const setSurface = (a: string, surf: string | null) => {
    upd({
      apps: d.apps.map((x): PromptApp => {
        if (x.app !== a) return x;
        if (surf === null) return { ...x, surfaces: [] };
        return {
          ...x,
          surfaces: x.surfaces.includes(surf)
            ? x.surfaces.filter((s) => s !== surf)
            : [...x.surfaces, surf],
        };
      }),
    });
  };
  const setModel = (a: string, model: string) =>
    upd({ apps: d.apps.map((x) => (x.app !== a ? x : { ...x, model, required: model.trim() ? x.required : false })) });
  const setRequired = (a: string, required: boolean) =>
    upd({ apps: d.apps.map((x) => (x.app !== a ? x : { ...x, required })) });

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

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    void (isWf ? ingestWorkflowFile(list) : ingestFiles(list));
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const list = Array.from(e.dataTransfer?.files ?? []);
    void (isWf ? ingestWorkflowFile(list) : ingestFiles(list));
  };

  /** A workflow's .md, read without changing a byte (BOM and line endings kept). */
  const ingestWorkflowFile = async (list: File[]) => {
    const f = list[0];
    if (!f) return;
    if (!isMarkdownName(f.name)) return show("Choose a .md file.");
    if (f.size > MAX_WORKFLOW_DOC_BYTES) {
      return show(`That file is ${formatBytes(f.size)}; the limit is ${formatBytes(MAX_WORKFLOW_DOC_BYTES)}.`);
    }
    const content = decodeExact(new Uint8Array(await f.arrayBuffer()));
    if (content === null) return show("That file isn't UTF-8 text, so it can't be kept exactly. Save it as UTF-8 and try again.");
    if (!content.trim()) return show("That file is empty.");
    if (route === "") setRoute("upload");
    const facts = docFacts(content);
    setD((cur) => ({
      ...cur,
      files: [{ name: f.name, content }, ...cur.files.slice(1)],
      title: cur.title.trim() ? cur.title : (facts.title ?? cur.title),
      description: cur.description.trim() ? cur.description : (facts.description ?? cur.description),
    }));
    const trigger = wf.trigger ? "" : suggestTrigger(content);
    const integrations = suggestIntegrations(content, integrationNames).filter((i) => !wf.integrations.some((x) => x.toLowerCase() === i.toLowerCase()));
    setSuggest(trigger || integrations.length ? { trigger, integrations } : null);
    show(`Added ${f.name}`);
  };
  const ingestFiles = async (list: File[]) => {
    if (!list.length || uploading) return;
    if (route === "") setRoute("upload");
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
        // SKILL.md leads the tab strip; everything else keeps its arrival order.
        merged.sort((a, b) => Number(isSkillMd(b.name)) - Number(isSkillMd(a.name)));
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

  // ── Routes (new skills) ───────────────────────────────────────────
  const pickRoute = (r: Route) => {
    setRoute(r);
    // Blank link rows are scaffolding, not entered data: drop them when leaving the link route.
    const links = r === "link" ? d.links : d.links.filter((l) => l.url.trim() || l.label.trim());
    const patch: Partial<PromptDraft> = links.length !== d.links.length ? { links } : {};
    if (r === "write" && !d.files.length) {
      patch.files = isWf ? [{ name: docFileName(d.title), content: WORKFLOW_TEMPLATE }] : [{ name: "SKILL.md", content: SKILL_TEMPLATE }];
      setFileIdx(0);
    }
    if (r === "link" && !d.links.length) patch.links = [{ label: "", url: "" }];
    if (Object.keys(patch).length) upd(patch);
  };
  const needsRoute = (isSkill || isWf) && route === "";
  const showRouteSwitch = isSkill && route !== "" && route !== "existing";
  const showFiles = isSkill && (route !== "link" || d.files.length > 0);
  // Links are optional on both kinds: where a skill lives, or where a prompt is saved
  // (a Granola recipe, a Claude project) so people can open it instead of pasting.
  const showLinks = route === "link" || d.links.length > 0;
  const showAddOther = route !== "" && ((route === "link" && !d.files.length) || (route !== "link" && !d.links.length));
  const filesRequired = isSkill && route !== "link" && !hasUrl;
  const linksRequired = isSkill && route === "link" && !d.files.length;
  const addOther = () => {
    if (route === "link") {
      upd({ files: [{ name: "SKILL.md", content: SKILL_TEMPLATE }] });
      setFileIdx(0);
    } else upd({ links: [...d.links, { label: "", url: "" }] });
  };

  // ── Details accordion summaries ───────────────────────────────────
  const appSummary = d.apps.length
    ? d.apps
        .map((a) => a.app + (a.surfaces.length ? ` (${a.surfaces.join(", ")})` : "") + (a.model.trim() ? ` · ${a.model.trim()}` : ""))
        .join(", ")
    : "Pick at least one app";
  const audSummary = d.audiences.length ? d.audiences.join(", ") : "Pick at least one team";
  const visSummary = d.visibility === "public" ? "Everyone at Clay" : "Only you and your editors";
  const teamSummary = d.editors.length ? `You and ${d.editors.length} other${d.editors.length === 1 ? "" : "s"}` : "Just you";
  const readySummary = wf.customerReady
    ? "Ready to send to customers"
    : findings.length
      ? `${findings.length} thing${findings.length === 1 ? "" : "s"} to check`
      : "Not confirmed yet";
  const toggleSec = (id: Section) => setOpenSec((cur) => (cur === id ? "" : id));

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
        const toast =
          mode === "edit"
            ? "saved"
            : mode === "fork"
              ? isWf
                ? "adapted"
                : "forked"
              : isSkill
                ? "published-skill"
                : isWf
                  ? "published-workflow"
                  : "published";
        router.push(`/prompts/${res.data.id}?toast=${toast}`);
      } catch {
        // A thrown action (network, payload too large) shouldn't take down the page.
        setError(
          isSkill || isWf
            ? `Couldn't save. The ${noun} may be too large to send; trim it and try again.`
            : "Couldn't save. Check your connection and try again.",
        );
      }
    });
  };

  const heading =
    mode === "create" ? `New ${noun}` : mode === "edit" ? `Edit ${noun}` : isWf ? "Adapt workflow" : `Fork ${noun}`;
  const saveLabel =
    mode === "edit" ? "Save changes" : mode === "fork" ? (isWf ? "Create adaptation" : "Create fork") : `Publish ${noun}`;
  const subhead = isSkill
    ? "Three things are needed: a name, the skill itself, and where it works."
    : isWf
      ? mode === "fork"
        ? "Say what this version is adapted for, then change the .md as needed."
        : "Two things are needed: a name and the architecture .md. It's kept exactly as uploaded."
      : "Three things are needed: a name, the prompt, and where it works.";
  const titleExample = isSkill
    ? "e.g. Clay formulas"
    : isWf
      ? "e.g. Inbound lead routing — reference architecture"
      : "e.g. Account research brief";
  const descExample = isSkill
    ? "e.g. Teaches the model Clay's formula syntax"
    : isWf
      ? "e.g. Validate, enrich, dedupe and route every inbound form fill"
      : "e.g. A one-page brief on any account before a first call";
  const Req = () => (
    <span className={`${styles.req} tone`} style={toneStyle(REQUIRED_TONE)}>
      Required
    </span>
  );

  const filesBlock = (
    <div className="field">
      <div className={styles.bodyHead}>
        <div className={styles.labelRow}>
          <span className="eyebrow">Files</span>
          {filesRequired ? <Req /> : null}
          <span className={styles.example}>SKILL.md plus anything it needs</span>
        </div>
        <span className={`tiny ${overLimit ? styles.error : "muted"}`}>
          {d.files.length} file{d.files.length === 1 ? "" : "s"}
          {d.files.length ? ` · ${formatBytes(totalBytes)} of ${formatBytes(MAX_SKILL_BYTES)}` : ""}
        </span>
      </div>
      <div
        className={skillStyles.editorFiles}
        data-dragging={dragging ? "" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
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
            {uploading ? "Adding files…" : "Upload"}
            <input type="file" multiple onChange={onUpload} disabled={!!uploading} style={{ display: "none" }} />
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
                    {curFile.type ? ` · ${curFile.type}` : ""}. Stored as-is and included in the .skill download.
                  </div>
                </div>
              </div>
            ) : (
              <textarea
                className={skillStyles.fileEditor}
                rows={16}
                spellCheck={false}
                value={curFile.content}
                onChange={(e) => setFile({ content: e.target.value })}
                aria-label={`Contents of ${curFile.name}`}
              />
            )}
          </>
        ) : (
          <label className={styles.dropzone} aria-disabled={!!uploading}>
            <UploadSimple size={26} className="muted" />
            <span className={styles.dropTitle}>Drop a .skill file, or click to browse</span>
            <span className={styles.dropSub}>
              It unpacks into its files here and fills in the title and description from SKILL.md. Text files stay editable; fonts,
              images and other binaries are stored as-is. Up to {formatBytes(MAX_SKILL_BYTES)} per skill.
            </span>
            <input type="file" multiple onChange={onUpload} disabled={!!uploading} style={{ display: "none" }} />
          </label>
        )}
      </div>
      {queue.length ? <UploadQueue items={queue} /> : null}
    </div>
  );

  const linksBlock = (
    <div className="field">
      <div className={styles.bodyHead}>
        <div className={styles.labelRow}>
          <span className="eyebrow">Links</span>
          {linksRequired ? <Req /> : null}
          <span className={styles.example}>
            {isSkill
              ? "Where it lives: a Claude project, a custom GPT, a Town agent"
              : isWf
                ? "The live Clay workflow, a walkthrough video, a related doc"
                : "Where it's saved: a Granola recipe, a Claude project, a custom GPT"}
          </span>
        </div>
        <span className="tiny muted">{d.links.length ? `${d.links.length} link${d.links.length === 1 ? "" : "s"}` : "Optional"}</span>
      </div>
      <div className="stack gap-2">
        {d.links.map((l, i) => (
          <div key={i} className={skillStyles.linkRow}>
            <input
              className={`input ${skillStyles.linkLabelInput}`}
              value={l.label}
              onChange={(e) => setLink(i, { label: e.target.value })}
              placeholder={isSkill ? "Label, e.g. Claude project" : isWf ? "Label, e.g. Open in Clay" : "Label, e.g. Granola recipe"}
              aria-label="Link label"
            />
            <input
              className={`input ${skillStyles.linkUrlInput}`}
              value={l.url}
              onChange={(e) => setLink(i, { url: e.target.value })}
              placeholder={isSkill ? "https://claude.ai/project/..." : isWf ? "https://app.clay.com/..." : "https://notes.granola.ai/..."}
              inputMode="url"
              aria-label="Link URL"
            />
            <button type="button" className="icon-btn" aria-label="Remove link" onClick={() => removeLink(i)}>
              <X size={16} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }} onClick={addLink}>
          <LinkIcon weight="bold" size={13} />
          Add link
        </button>
      </div>
    </div>
  );

  const docBlock = (
    <div className="field">
      <div className={styles.bodyHead}>
        <div className={styles.labelRow}>
          <span className="eyebrow">Architecture .md</span>
          <Req />
          <span className={styles.example}>Stored and downloaded exactly as uploaded</span>
        </div>
        <span className={`tiny ${docTooBig ? styles.error : "muted"}`}>
          {doc ? `${formatBytes(docBytes)} of ${formatBytes(MAX_WORKFLOW_DOC_BYTES)}` : "One .md file"}
        </span>
      </div>
      <div
        className={skillStyles.editorFiles}
        data-dragging={dragging ? "" : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {doc ? (
          <>
            <div className={skillStyles.editorFileMeta}>
              <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>
                File name
              </span>
              <input
                className={skillStyles.fileNameInput}
                value={doc.name}
                onChange={(e) => setDoc({ name: e.target.value })}
                aria-label="File name"
              />
              <label className={skillStyles.uploadLabel}>
                <UploadSimple weight="bold" size={13} />
                Replace
                <input type="file" accept=".md,.markdown,text/markdown" onChange={onUpload} style={{ display: "none" }} />
              </label>
            </div>
            <textarea
              className={skillStyles.fileEditor}
              rows={18}
              spellCheck={false}
              value={doc.content}
              onChange={(e) => setDoc({ content: e.target.value })}
              aria-label={`Contents of ${doc.name}`}
            />
          </>
        ) : (
          <label className={styles.dropzone}>
            <UploadSimple size={26} className="muted" />
            <span className={styles.dropTitle}>Drop your architecture .md here, or click to browse</span>
            <span className={styles.dropSub}>
              The title and description fill in from the file. It&apos;s stored byte for byte, so the download matches what you
              uploaded. Up to {formatBytes(MAX_WORKFLOW_DOC_BYTES)}.
            </span>
            <input type="file" accept=".md,.markdown,text/markdown" onChange={onUpload} style={{ display: "none" }} />
          </label>
        )}
      </div>
      {doc ? (
        <span className="tiny muted">Editing the text here changes the file people download. Each save keeps the previous version.</span>
      ) : null}
    </div>
  );

  const attachmentsBlock = doc ? (
    <div className="field">
      <div className={styles.bodyHead}>
        <div className={styles.labelRow}>
          <span className="eyebrow">Attachments</span>
          <span className={styles.example}>Diagrams, sample payloads, exports. Optional.</span>
        </div>
        <span className="tiny muted">
          {attachments.length
            ? `${attachments.length} of ${MAX_WORKFLOW_ATTACHMENTS} · ${formatBytes(attBytes)} of ${formatBytes(MAX_SKILL_BYTES)}`
            : `Up to ${MAX_WORKFLOW_ATTACHMENTS} files`}
        </span>
      </div>
      {attachments.length ? (
        <div className={styles.findings}>
          {attachments.map((a) => (
            <div key={a.name} className={styles.finding} style={{ alignItems: "center" }}>
              <Cube size={15} className="muted" />
              <span className="small grow truncate">{a.name}</span>
              <span className="tiny muted">{formatBytes(a.size ?? 0)}</span>
              <button type="button" className="icon-btn" aria-label={`Remove ${a.name}`} onClick={() => removeAttachment(a.name)}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <label className={skillStyles.uploadLabel} style={{ alignSelf: "flex-start" }} aria-disabled={!!attBusy} data-busy={attBusy ? "" : undefined}>
        {attBusy ? <span className={skillStyles.btnSpinner} aria-hidden="true" /> : <Plus weight="bold" size={13} />}
        {attBusy ?? "Add attachments"}
        <input
          type="file"
          multiple
          disabled={!!attBusy}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addAttachments(list);
          }}
          style={{ display: "none" }}
        />
      </label>
    </div>
  ) : null;

  const suggestBlock =
    isWf && suggest && suggestLeft ? (
      <div className={styles.suggest}>
        <span className="small" style={{ fontWeight: 600 }}>
          We spotted these in your file. Add them?
        </span>
        <div className="row gap-2 wrap">
          {suggest.trigger ? (
            <button
              type="button"
              className={styles.routeChip}
              onClick={() => {
                setWf({ trigger: suggest.trigger });
                setSuggest({ ...suggest, trigger: "" });
              }}
            >
              <Plus weight="bold" size={12} />
              Trigger: {TRIGGER_LABELS[suggest.trigger]}
            </button>
          ) : null}
          {suggest.integrations.map((i) => (
            <button
              key={i}
              type="button"
              className={styles.routeChip}
              onClick={() => {
                addIntegration(i);
                setSuggest({ ...suggest, integrations: suggest.integrations.filter((x) => x !== i) });
              }}
            >
              <Plus weight="bold" size={12} />
              {i}
            </button>
          ))}
        </div>
        <div className="row gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (suggest.trigger) setWf({ trigger: suggest.trigger });
              suggest.integrations.forEach(addIntegration);
              setSuggest(null);
            }}
          >
            Add all
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSuggest(null)}>
            Dismiss
          </button>
        </div>
      </div>
    ) : null;

  const appNames = [
    ...activeApps(catalog).map((a) => a.name),
    // Keep an archived app visible while it's still selected on this item.
    ...d.apps.map((x) => x.app).filter((n) => !activeApps(catalog).some((a) => a.name === n)),
  ];
  const teamNames = [
    ...activeTeams(catalog).map((t) => t.name),
    ...d.audiences.filter((n) => !activeTeams(catalog).some((t) => t.name === n)),
  ];

  const section = (id: Section, title: string, sub: string, summary: string, filled: boolean, required: boolean, body: React.ReactNode) => {
    const open = openSec === id;
    return (
      <div className={styles.acc} data-open={open ? "" : undefined}>
        <button type="button" className={styles.accHead} aria-expanded={open} aria-controls={`sec-${id}`} onClick={() => toggleSec(id)}>
          <span className={styles.accTitles}>
            <span className={styles.accTitleRow}>
              <span className={styles.accTitle}>{title}</span>
              {required && !filled ? <Req /> : null}
            </span>
            <span className={styles.accSub}>{sub}</span>
          </span>
          <span className={`${styles.accSummary} truncate`} data-unfilled={filled ? undefined : ""}>
            {summary}
          </span>
          {open ? <CaretUp weight="bold" size={14} className="muted" /> : <CaretDown weight="bold" size={14} className="muted" />}
        </button>
        {open ? (
          <div id={`sec-${id}`} className={styles.accBody}>
            {body}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className={styles.section}>
      <Link href={cancelHref} className="back-link">
        <ArrowLeft weight="bold" size={13} />
        Cancel
      </Link>
      <div className={styles.titleBlock}>
        <h1 className="display-md">{heading}</h1>
        <p className={styles.subhead}>{subhead}</p>
        {mode === "fork" ? (
          <div className={styles.forkLine}>
            <GitFork weight="bold" size={14} />
            <span>
              {isWf ? "Adapting" : "Forking"} <span className={styles.forkParent}>{parentTitle}</span>. Your version stays linked to the
              original{isWf ? ", and both stay in the library" : ""}.
            </span>
          </div>
        ) : null}
      </div>

      {needsRoute ? (
        <div className={styles.routeGrid} role="group" aria-label={`How does this ${noun} arrive?`}>
          {(
            (isWf
              ? [
                  ["upload", "Upload a .md", "Most people start here. The title and description fill in, and the file is kept byte for byte.", "/icons/Templates.png"],
                  ["write", "Write or paste it here", "Start from the reference-architecture template, or paste Markdown over it.", "/icons/Pencil.png"],
                ]
              : [
                  ["upload", "Upload a .skill file", "It unpacks into files and fills in the name and description.", "/icons/Templates.png"],
                  ["write", "Write it here", "Start from the SKILL.md template and edit in place.", "/icons/Pencil.png"],
                  ["link", "Just link it", "It already lives in a Claude project, a custom GPT, or a Town agent.", "/icons/Search.png"],
                ]) as [Route, string, string, string][]
          ).map(([key, label, sub, icon]) =>
            isWf && key === "upload" ? (
              <label
                key={key}
                className={styles.routeCard}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                style={{ cursor: "pointer" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={icon} alt="" className={styles.routeIcon} />
                <span className={styles.routeLabel}>{label}</span>
                <span className={styles.routeSub}>{sub}</span>
                <input type="file" accept=".md,.markdown,text/markdown" onChange={onUpload} style={{ display: "none" }} />
              </label>
            ) : (
            <button key={key} type="button" className={styles.routeCard} onClick={() => pickRoute(key)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon} alt="" className={styles.routeIcon} />
              <span className={styles.routeLabel}>{label}</span>
              <span className={styles.routeSub}>{sub}</span>
            </button>
            ),
          )}
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {showRouteSwitch ? (
            <div className={styles.routeSwitch}>
              <span className="tiny muted">This skill is</span>
              {(
                [
                  ["upload", "A file", FileText],
                  ["write", "Written here", PencilSimple],
                  ["link", "A link", LinkIcon],
                ] as [Route, string, typeof FileText][]
              ).map(([key, label, Icon]) => (
                <button key={key} type="button" className={styles.routeChip} aria-pressed={route === key} onClick={() => pickRoute(key)}>
                  <Icon size={13} />
                  {label}
                </button>
              ))}
              <span className="tiny muted">Switching keeps what you have entered.</span>
            </div>
          ) : null}

          <label className="field">
            <div className={styles.labelRow}>
              <span className="eyebrow">Title</span>
              <Req />
              <span className={styles.example}>{titleExample}</span>
            </div>
            <input
              className={`input ${styles.titleInput}`}
              value={d.title}
              onChange={(e) => upd({ title: e.target.value })}
              placeholder="Name it"
              maxLength={200}
              required
            />
          </label>
          <label className="field">
            <div className={styles.labelRow}>
              <span className="eyebrow">Description</span>
              <span className={styles.example}>{descExample}</span>
            </div>
            <input
              className="input"
              style={{ padding: "11px 14px" }}
              value={d.description}
              onChange={(e) => upd({ description: e.target.value })}
              placeholder="One line on what it does and when to use it"
              maxLength={600}
            />
          </label>
          {mode === "fork" ? (
            <label className="field">
              <div className={styles.labelRow}>
                <span className="eyebrow">{isWf ? "Adapted for" : "What did you change"}</span>
                {isWf ? <Req /> : null}
                <span className={styles.example}>
                  {isWf
                    ? "e.g. Acme: HubSpot instead of Salesforce, or EMEA territories only"
                    : "e.g. Added a competitor section, cut it to 5 bullets"}
                </span>
              </div>
              <input
                className="input"
                style={{ padding: "11px 14px" }}
                value={d.forkNote}
                onChange={(e) => upd({ forkNote: e.target.value })}
                placeholder={isWf ? "Who or what this version is for" : "What did you change"}
                maxLength={600}
                required={isWf}
              />
            </label>
          ) : null}

          {showFiles ? filesBlock : null}
          {isWf ? docBlock : null}
          {suggestBlock}
          {isWf ? attachmentsBlock : null}
          {isSkill && showLinks ? linksBlock : null}
          {isSkill && showAddOther ? (
            <button type="button" className={styles.addOther} onClick={addOther}>
              <Plus weight="bold" size={13} />
              {route === "link" ? "Add files as well" : "Add a link as well"}
            </button>
          ) : null}

          {isPrompt ? (
            <div className="field">
              <div className={styles.bodyHead}>
                <div className={styles.labelRow}>
                  <span className="eyebrow">Prompt</span>
                  <Req />
                  <span className={styles.example}>The words you paste into the tool</span>
                </div>
                <span className="tiny muted">
                  Placeholders go in <code className={styles.code}>{"{{company}}"}</code>
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
                  {keys.length ? `${keys.length} placeholder${keys.length === 1 ? "" : "s"} detected:` : "No placeholders yet."}
                </span>
                {keys.map((k) => (
                  <span key={k} className={styles.phPill}>
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {!isSkill && showLinks ? linksBlock : null}
          {!isSkill && showAddOther ? (
            <button type="button" className={styles.addOther} onClick={addOther}>
              <Plus weight="bold" size={13} />
              {isWf ? "Add a link (e.g. the live Clay workflow)" : "Add a link to where it's saved (a Granola recipe, a Claude project)"}
            </button>
          ) : null}

          <label className="field">
            <div className={styles.bodyHead}>
              <span className="eyebrow">How to use</span>
              <span className="tiny muted">Optional. Shown under the {noun}, not copied with it.</span>
            </div>
            <textarea
              className="textarea"
              rows={4}
              value={d.notes}
              onChange={(e) => upd({ notes: e.target.value })}
              placeholder={"When to use it, tips, connectors it needs. Start a line with \"- \" for a bullet."}
              maxLength={5000}
            />
          </label>

          {isWf ? (
            <div className={styles.inlineFields}>
              <div className={styles.inlineField}>
                <span className="label">Trigger</span>
                <div className={styles.choices} role="group" aria-label="Trigger">
                  {WORKFLOW_TRIGGERS.map((t) => (
                    <button key={t} type="button" className={styles.choice} aria-pressed={wf.trigger === t} onClick={() => setWf({ trigger: wf.trigger === t ? "" : t })}>
                      {TRIGGER_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.inlineField}>
                <span className="label">Stage</span>
                <div className={styles.choices} role="group" aria-label="Stage">
                  {WORKFLOW_STAGES.map((st) => (
                    <button key={st} type="button" className={styles.choice} aria-pressed={(wf.stage || "draft") === st} onClick={() => setWf({ stage: st })}>
                      {STAGE_LABELS[st]}
                    </button>
                  ))}
                </div>
              </div>
              <div className={`${styles.inlineField} ${styles.inlineFieldWide}`}>
                <span className="label">Integrations</span>
                  <div className="stack" style={{ gap: 12 }}>
                    {wf.integrations.length ? (
                      <div className="row gap-2 wrap">
                        {wf.integrations.map((i) => (
                          <button key={i} type="button" className={styles.routeChip} aria-pressed onClick={() => removeIntegration(i)} aria-label={`Remove ${i}`}>
                            {i}
                            <X weight="bold" size={11} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {wf.integrations.some((i) => !catalogIntegration(catalog, i)) && catalog.integrations?.length ? (
                      <span className="tiny muted">
                        Not in the list yet: {wf.integrations.filter((i) => !catalogIntegration(catalog, i)).join(", ")}. The Workflows team
                        can add it to the list.
                      </span>
                    ) : null}
                    <div className="row gap-2 wrap">
                      {integrationNames.filter((n) => !wf.integrations.some((x) => x.toLowerCase() === n.toLowerCase())).map((n) => (
                        <button key={n} type="button" className={styles.routeChip} onClick={() => addIntegration(n)}>
                          <Plus weight="bold" size={11} />
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className={styles.inviteRow}>
                      <input
                        className={styles.inviteInput}
                        value={intInput}
                        onChange={(e) => setIntInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addIntegration(intInput);
                            setIntInput("");
                          }
                        }}
                        placeholder="Another integration"
                        aria-label="Add an integration"
                        maxLength={40}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          addIntegration(intInput);
                          setIntInput("");
                        }}
                      >
                        Add
                      </button>
                    </div>
                  </div>
              </div>
            </div>
          ) : null}

          {/* ── Details accordion ── */}
          <div className={styles.details}>
            <div className="stack" style={{ gap: 2 }}>
              <span className="eyebrow">Details</span>
              <span className="tiny muted">Already filled in sensibly. Open a row only if you want to change it.</span>
            </div>

            {section(
              "apps",
              "Where it works",
              "Apps, surfaces, and a model if one is needed",
              appSummary,
              d.apps.length > 0,
              true,
              <div className={styles.appRows}>
                {appNames.map((a) => {
                  const x = d.apps.find((y) => y.app === a);
                  const tone = appTone(catalog, a);
                  const surfs = surfacesOf(catalog, a);
                  const hint = catalog.apps.find((c) => c.name === a)?.modelHint || "e.g. model name";
                  const pill = (label: string, on: boolean, onClick: () => void) => (
                    <button key={label} type="button" className={styles.surfacePill} aria-pressed={on} onClick={onClick}>
                      {label}
                    </button>
                  );
                  return (
                    <div key={a} className={`${styles.appRow} tone`} style={toneStyle(tone)} data-on={x ? "" : undefined}>
                      <button type="button" className={styles.appRowHead} role="checkbox" aria-checked={!!x} onClick={() => toggleApp(a)}>
                        {x ? (
                          <CheckSquare weight="fill" size={18} style={{ color: "var(--tone-ink)" }} />
                        ) : (
                          <Square size={18} style={{ color: "var(--tone-ink)" }} />
                        )}
                        <span className="grow">{a}</span>
                        {x ? (
                          <span className="tiny muted">{x.surfaces.length ? `Works in ${x.surfaces.join(", ")}` : `Works anywhere in ${a}`}</span>
                        ) : null}
                      </button>
                      {x ? (
                        <div className={styles.appRowBody}>
                          {surfs.length ? (
                            <div className={styles.fieldRow}>
                              <span className={styles.fieldLabel}>Surface</span>
                              <div className={styles.surfacePills}>
                                {pill("Anywhere", x.surfaces.length === 0, () => setSurface(a, null))}
                                {surfs.map((sf) => pill(sf, x.surfaces.includes(sf), () => setSurface(a, sf)))}
                              </div>
                            </div>
                          ) : null}
                          <div className={styles.fieldRow}>
                            <label className={styles.fieldLabel} htmlFor={`model-${a}`}>
                              Model
                            </label>
                            <input
                              id={`model-${a}`}
                              className={`input ${styles.modelInput}`}
                              value={x.model}
                              onChange={(e) => setModel(a, e.target.value)}
                              placeholder={`${hint} — leave blank for any`}
                              maxLength={80}
                            />
                          </div>
                          {x.model.trim() ? (
                            <div className={styles.fieldRow}>
                              <span className={styles.fieldLabel} aria-hidden="true" />
                              <div className={styles.surfacePills} role="group" aria-label={`Is ${x.model} required for ${a}?`}>
                                {pill("Recommended", !x.required, () => setRequired(a, false))}
                                {pill("Required", x.required, () => setRequired(a, true))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>,
            )}

            {section(
              "auds",
              "Built for",
              "Which teams should find it",
              audSummary,
              d.audiences.length > 0,
              true,
              <div className={styles.checkRows}>
                {teamNames.map((a) => {
                  const on = d.audiences.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      className={styles.checkRow}
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => upd({ audiences: on ? d.audiences.filter((x) => x !== a) : [...d.audiences, a] })}
                    >
                      {on ? <CheckSquare weight="fill" size={18} /> : <Square size={18} className="muted" />}
                      <span className="grow">{a}</span>
                    </button>
                  );
                })}
              </div>,
            )}

            {isWf ? (
              <>
                {section(
                  "ready",
                  "Customer-ready",
                  "Safe to send to a customer as is",
                  readySummary,
                  wf.customerReady || !findings.length,
                  false,
                  <div className="stack" style={{ gap: 12 }}>
                    {findings.length ? (
                      <>
                        <span className="small muted">
                          We scanned the .md for things that shouldn&apos;t leave Clay. These are warnings: you decide.
                        </span>
                        <div className={styles.findings}>
                          {findings.slice(0, 8).map((f, i) => (
                            <div key={i} className={styles.finding}>
                              <Warning weight="bold" size={15} className={styles.findingIcon} />
                              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                                <span className="small">
                                  <strong>Line {f.line}</strong> · {f.message}
                                </span>
                                <code className={`${styles.code} truncate`}>{f.excerpt}</code>
                              </div>
                            </div>
                          ))}
                          {findings.length > 8 ? <span className="tiny muted">…and {findings.length - 8} more.</span> : null}
                        </div>
                      </>
                    ) : (
                      <div className={styles.finding}>
                        <CheckCircle weight="bold" size={15} className={styles.okIcon} />
                        <span className="small">No internal emails, record IDs, hostnames, Slack IDs or credentials found.</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={styles.checkRow}
                      role="checkbox"
                      aria-checked={wf.customerReady}
                      onClick={() => setWf({ customerReady: !wf.customerReady })}
                    >
                      {wf.customerReady ? <CheckSquare weight="fill" size={18} /> : <Square size={18} className="muted" />}
                      <span className="grow">I&apos;ve checked this is safe to send to customers.</span>
                    </button>
                    {activeShares > 0 ? (
                      <span className={`tiny ${!wf.customerReady && initial.workflow?.customerReady ? styles.error : "muted"}`}>
                        {!wf.customerReady && initial.workflow?.customerReady
                          ? `Saving will revoke ${activeShares} published link${activeShares === 1 ? "" : "s"}.`
                          : `${activeShares} published link${activeShares === 1 ? "" : "s"}. Unticking this revokes ${activeShares === 1 ? "it" : "them"}.`}
                      </span>
                    ) : null}
                  </div>,
                )}
              </>
            ) : null}

            {section(
              "vis",
              "Visibility",
              "Who can find it in the library",
              visSummary,
              true,
              false,
              <div className="stack" style={{ gap: 6 }}>
                {VIS_OPTIONS.map(({ k, label, sub, Icon }) => (
                  <button key={k} type="button" className={styles.visOption} aria-pressed={d.visibility === k} onClick={() => upd({ visibility: k })}>
                    <Icon size={18} className="muted" />
                    <span className="stack" style={{ gap: 2 }}>
                      <span className={styles.visLabel}>{label}</span>
                      <span className="tiny muted">{sub}</span>
                    </span>
                  </button>
                ))}
              </div>,
            )}

            {section(
              "team",
              "Editors",
              "Who else can change it and answer feedback",
              teamSummary,
              true,
              false,
              <div className="stack" style={{ gap: 12 }}>
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
                        onRemove={removable ? () => upd({ editors: d.editors.filter((e) => e !== email) }) : undefined}
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
                <span className="tiny muted">Editors can change the {noun} and resolve feedback. Anyone can fork.</span>
              </div>,
            )}
          </div>

          <div className={styles.footer}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={!valid || pending}>
              {pending ? "Saving…" : saveLabel}
            </button>
            <Link href={cancelHref} className="btn btn-outline btn-lg">
              Cancel
            </Link>
            <span className={`tiny ${error ? styles.error : "muted"}`} role={error ? "alert" : undefined}>
              {error ?? (valid ? readyHint : hint)}
            </span>
          </div>
        </form>
      )}
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
