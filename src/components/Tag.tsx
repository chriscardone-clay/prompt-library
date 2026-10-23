import { ArrowsClockwise, CheckCircle, Files, FlowArrow, GitFork, LockSimple, Medal, ShieldCheck, Warning } from "@phosphor-icons/react/dist/ssr";
import {
  ADAPTATION_TONE,
  APPROVED_TONE,
  GOLD_TONE,
  STALE_TONE,
  FALLBACK_TONE,
  NOT_READY_TONE,
  OUTDATED_TONE,
  READY_TONE,
  REFERENCE_TONE,
  type Tone,
  toneStyle,
  WORKFLOW_TONE,
} from "@/lib/catalog";
import { STAGE_LABELS, TRIGGER_LABELS, type WorkflowStage, type WorkflowTrigger } from "@/lib/constants";
import type { Approval, PromptApp } from "@/lib/types";

export function appLabel(a: PromptApp): string {
  return a.surfaces.length ? `${a.app} · ${a.surfaces.join(", ")}` : a.app;
}

/** App tag in the app's catalog colours (100 tint background, 400 ink; derived in dark mode). */
export function AppTag({ app, tone = FALLBACK_TONE, short = false }: { app: PromptApp; tone?: Tone; short?: boolean }) {
  return (
    <span className="tag tone" style={toneStyle(tone)} data-tip={`Built for ${appLabel(app)}`}>
      {short ? app.app : appLabel(app)}
    </span>
  );
}

export function AudienceTag({ audience, light }: { audience: string; light?: boolean }) {
  return <span className={`tag${light ? " tag-light" : ""}`}>{audience}</span>;
}

export function SkillTag() {
  return (
    <span className="tag" style={{ background: "var(--fg)", color: "var(--oat-100)" }} data-tip="Skill: a SKILL.md bundle you install into Claude or ChatGPT so it follows the same steps every time">
      <Files weight="bold" size={11} />
      Skill
    </span>
  );
}

export function ForkTag() {
  return (
    <span className="tag tag-light tag-muted" data-tip="Fork: someone's own version of another item">
      <GitFork weight="bold" size={11} />
      Fork
    </span>
  );
}

export function PrivateTag() {
  return (
    <span className="tag tag-muted" data-tip="Private: only the owner and editors can see it">
      <LockSimple weight="bold" size={11} />
      Private
    </span>
  );
}

export function WorkflowTag() {
  return (
    <span className="tag tone" style={toneStyle(WORKFLOW_TONE)} data-tip="Workflow: a Clay Workflows reference architecture you can adapt">
      <FlowArrow weight="bold" size={11} />
      Workflow
    </span>
  );
}

/** "Reference architecture" for an original workflow, "Adaptation" for a fork. */
export function OriginTag({ adapted }: { adapted: boolean }) {
  return (
    <span className="tag tone" style={toneStyle(adapted ? ADAPTATION_TONE : REFERENCE_TONE)} data-tip={adapted ? "Adaptation: a reference architecture tailored for a specific customer or use" : "Reference architecture: the original design others adapt"}>
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
    <span className="tag tone" style={toneStyle(ready ? READY_TONE : NOT_READY_TONE)} data-tip={ready ? "Customer-ready: checked for internal details, safe to share with customers" : "Not customer-ready yet: may contain internal details"}>
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

/** Enablement's verdict: gold standard, approved, or approved-then-edited. Nothing for unreviewed items. */
export function ApprovalTag({ approval, short = false }: { approval: Approval; short?: boolean }) {
  if (approval.outdated) {
    return (
      <span className="tag tone" style={toneStyle(OUTDATED_TONE)} data-tip={`Enablement flagged this as outdated${approval.outdated.note ? `: ${approval.outdated.note}` : ""}. It's listed after current items.`}>
        <Warning weight="bold" size={11} />
        Outdated
      </span>
    );
  }
  if (approval.tier === "none") return null;
  if (!approval.current) {
    return (
      <span className="tag tone" style={toneStyle(STALE_TONE)} data-tip="Enablement approved an earlier version. It has changed since, so it isn't boosted until it's reviewed again.">
        <ArrowsClockwise weight="bold" size={11} />
        {short ? "Earlier version approved" : "Approved earlier version"}
      </span>
    );
  }
  const gold = approval.tier === "gold";
  return (
    <span
      className="tag tone"
      style={toneStyle(gold ? GOLD_TONE : APPROVED_TONE)}
      data-tip={gold ? `Gold standard${approval.useCase ? ` for ${approval.useCase}` : ""}: Enablement's top pick, shown first` : "Enablement approved: reviewed by Clay's Enablement team and ranked higher"}
    >
      {gold ? <Medal weight="bold" size={11} /> : <ShieldCheck weight="bold" size={11} />}
      {gold ? "Gold standard" : short ? "Approved" : "Enablement approved"}
    </span>
  );
}
