import { Files, GitFork, LockSimple } from "@phosphor-icons/react/dist/ssr";
import { FALLBACK_TONE } from "@/lib/catalog";
import type { PromptApp } from "@/lib/types";

export function appLabel(a: PromptApp): string {
  return a.surfaces.length ? `${a.app} · ${a.surfaces.join(", ")}` : a.app;
}

/** App tag in the app's catalog colours (100 tint background, 400 ink). */
export function AppTag({ app, tone = FALLBACK_TONE }: { app: PromptApp; tone?: { bg: string; fg: string } }) {
  return (
    <span className="tag" style={{ background: tone.bg, color: tone.fg }}>
      {appLabel(app)}
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
