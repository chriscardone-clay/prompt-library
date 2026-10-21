/**
 * The managed catalog: which apps a prompt can be built for (with their
 * surfaces, tag colours and install instructions) and which teams it can be
 * for. Lives in the database (tables apps / surfaces / teams), edited from
 * /admin, and loaded per request by getCatalog() in data.ts. These helpers
 * are pure so client components can use them too.
 */

export interface CatalogSurface {
  name: string;
  install: string;
  position: number;
}

export interface CatalogApp {
  name: string;
  bg: string;
  fg: string;
  install: string;
  /** Placeholder for the editor's model field, e.g. "e.g. Opus 4.6". */
  modelHint: string;
  archived: boolean;
  position: number;
  surfaces: CatalogSurface[];
}

export interface CatalogTeam {
  name: string;
  archived: boolean;
  position: number;
}

/** An integration a workflow can name (managed by the Workflows team). */
export interface CatalogIntegration {
  name: string;
  color: string;
  archived: boolean;
  position: number;
}

export interface Catalog {
  apps: CatalogApp[];
  teams: CatalogTeam[];
  /** Workflow integrations; absent where the catalog was built without them. */
  integrations?: CatalogIntegration[];
}

export const EMPTY_CATALOG: Catalog = { apps: [], teams: [] };

/** Oat-200 slab + ink: what an unknown or archived-and-removed app falls back to. */
export const FALLBACK_TONE = { bg: "#F4F3F0", fg: "#1B1A18" };
/** Tint + ink for "Required model" badges (tangerine 100 / 400). */
export const REQUIRED_TONE = { bg: "#FFF3ED", fg: "#B53D0A" };
/** Workflow badges: the kind (blueberry), reference vs adaptation, customer-ready. */
export const WORKFLOW_TONE = { bg: "#E6F0FF", fg: "#2F49C9" };
export const REFERENCE_TONE = { bg: "#F0FCFF", fg: "#006F8A" };
export const ADAPTATION_TONE = { bg: "#F5F3FF", fg: "#6D4CD6" };
export const READY_TONE = { bg: "#FCFEE2", fg: "#3E5A05" };
export const NOT_READY_TONE = { bg: "#FEFAE8", fg: "#7A4502" };
export const GOLD_TONE = { bg: "#FBE189", fg: "#4A2C00" };
export const APPROVED_TONE = { bg: "#EEF773", fg: "#102B03" };
export const STALE_TONE = { bg: "#F4F3F0", fg: "#66645F" };

export interface Tone {
  bg: string;
  fg: string;
}

/**
 * Inline style carrying an app's colours as CSS variables. Pair it with the
 * global `tone` class: light mode uses the pair as-is, dark mode derives a
 * matching pair from the ink (see globals.css), so components should read
 * `var(--tone-surface)` / `var(--tone-ink)` rather than the raw values.
 */
export function toneStyle(tone: Tone, extra?: Record<string, string | number>): Record<string, string | number> {
  return { "--tone-bg": tone.bg, "--tone-fg": tone.fg, ...extra };
}

export function findApp(catalog: Catalog, name: string): CatalogApp | undefined {
  return catalog.apps.find((a) => a.name === name);
}

export function appTone(catalog: Catalog, name: string): { bg: string; fg: string } {
  const a = findApp(catalog, name);
  return a ? { bg: a.bg, fg: a.fg } : FALLBACK_TONE;
}

export function surfacesOf(catalog: Catalog, app: string): string[] {
  return findApp(catalog, app)?.surfaces.map((s) => s.name) ?? [];
}

/** Apps offered in pickers and filters (archived ones still render on existing items). */
export function activeApps(catalog: Catalog): CatalogApp[] {
  return catalog.apps.filter((a) => !a.archived);
}

export function activeTeams(catalog: Catalog): CatalogTeam[] {
  return catalog.teams.filter((t) => !t.archived);
}

export function activeIntegrations(catalog: Catalog): CatalogIntegration[] {
  return (catalog.integrations ?? []).filter((i) => !i.archived);
}

/** The catalog's spelling of an integration name, matched case-insensitively. */
export function catalogIntegration(catalog: Catalog, name: string): CatalogIntegration | undefined {
  const key = name.trim().toLowerCase();
  return (catalog.integrations ?? []).find((i) => i.name.toLowerCase() === key);
}

export function isKnownApp(catalog: Catalog, name: string): boolean {
  return catalog.apps.some((a) => a.name === name);
}

export function isKnownTeam(catalog: Catalog, name: string): boolean {
  return catalog.teams.some((t) => t.name === name);
}

/** Install text for "App · Surface", falling back to the app's own text. */
export function installFor(catalog: Catalog, app: string, surface?: string): string {
  const a = findApp(catalog, app);
  if (!a) return "";
  if (surface) {
    const s = a.surfaces.find((x) => x.name === surface);
    if (s?.install) return s.install;
  }
  return a.install;
}
