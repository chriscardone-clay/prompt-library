import { GitFork, LockSimple } from "@phosphor-icons/react/dist/ssr";
import { APP_COLORS } from "@/lib/constants";
import type { PromptApp } from "@/lib/types";

export function appLabel(a: PromptApp): string {
  return a.surfaces.length ? `${a.app} · ${a.surfaces.join(", ")}` : a.app;
}

export function AppTag({ app }: { app: PromptApp }) {
  const c = APP_COLORS[app.app];
  return (
    <span className="tag" style={{ background: c.bg, color: c.fg }}>
      {appLabel(app)}
    </span>
  );
}

export function AudienceTag({ audience, light }: { audience: string; light?: boolean }) {
  return <span className={`tag${light ? " tag-light" : ""}`}>{audience}</span>;
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
