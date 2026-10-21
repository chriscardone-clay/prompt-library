import { CheckCircle, Files, FlowArrow, GitFork, LockSimple } from "@phosphor-icons/react/dist/ssr";
import {
  ADAPTATION_TONE,
  FALLBACK_TONE,
  NOT_READY_TONE,
  READY_TONE,
  REFERENCE_TONE,
  type Tone,
  toneStyle,
  WORKFLOW_TONE,
} from "@/lib/catalog";
import { STAGE_LABELS, TRIGGER_LABELS, type WorkflowStage, type WorkflowTrigger } from "@/lib/constants";
import type { PromptApp } from "@/lib/types";

export function appLabel(a: PromptApp): string {
  return a.surfaces.length ? `${a.app} · ${a.surfaces.join(", ")}` : a.app;
}

/** App tag in the app's catalog colours (100 tint background, 400 ink; derived in dark mode). */
export function AppTag({ app, tone = FALLBACK_TONE, short = false }: { app: PromptApp; tone?: Tone; short?: boolean }) {
  return (
    <span className="tag tone" style={toneStyle(tone)} title={short && app.surfaces.length ? appLabel(app) : undefined}>
      {short ? app.app : appLabel(app)}
    </span>
  );
}

export function AudienceTag({ audience, light }: { audience: string; light?: boolean }) {
  return <span className={`tag${light ? " tag-light" : ""}`}>{audience}</span>;
}

export function SkillTag() {
  return (
    <span className="tag" style={{ background: "var(--fg)", color: "var(--oat-100)" }}>
      <Files weight="bold" size={11} />
      Skill
    </span>
  );
}

export function ForkTag() {
  return (
    <span className="tag tag-light tag-muted" title="Forked prompt">
      <GitFork weight="bold" size={11} />
      Fork
    </span>
  );
}

export function PrivateTag() {
  return (
    <span className="tag tag-muted">
      <LockSimple weight="bold" size={11} />
      Private
    </span>
  );
}

export function WorkflowTag() {
  return (
    <span className="tag tone" style={toneStyle(WORKFLOW_TONE)}>
      <FlowArrow weight="bold" size={11} />
      Workflow
    </span>
  );
}

/** "Reference architecture" for an original workflow, "Adaptation" for a fork. */
export function OriginTag({ adapted }: { adapted: boolean }) {
  return (
    <span className="tag tone" style={toneStyle(adapted ? ADAPTATION_TONE : REFERENCE_TONE)}>
      {adapted ? "Adaptation" : "Reference architecture"}
    </span>
  );
}

export function TriggerTag({ trigger }: { trigger: WorkflowTrigger | "" }) {
  if (!trigger) return null;
  return <span className="tag tag-light">{TRIGGER_LABELS[trigger]}</span>;
}

export function StageTag({ stage }: { stage: WorkflowStage | "" }) {
  if (!stage) return null;
  return <span className="tag tag-light tag-muted">{STAGE_LABELS[stage]}</span>;
}

export function ReadyTag({ ready, showNotReady = false }: { ready: boolean; showNotReady?: boolean }) {
  if (!ready && !showNotReady) return null;
  return (
    <span className="tag tone" style={toneStyle(ready ? READY_TONE : NOT_READY_TONE)}>
      {ready ? <CheckCircle weight="bold" size={11} /> : null}
      {ready ? "Customer-ready" : "Not customer-ready"}
    </span>
  );
}

/** An integration on a workflow, with its catalog colour as a dot (grey when unlisted). */
export function IntegrationTag({ name, color }: { name: string; color?: string }) {
  return (
    <span className="tag tag-light">
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 3, background: color ?? "var(--oat-300)", flex: "none" }} />
      {name}
    </span>
  );
}
