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
  archived: boolean;
  position: number;
  surfaces: CatalogSurface[];
}

export interface CatalogTeam {
  name: string;
  archived: boolean;
  position: number;
}

export interface Catalog {
  apps: CatalogApp[];
  teams: CatalogTeam[];
}

export const EMPTY_CATALOG: Catalog = { apps: [], teams: [] };

/** Oat-200 slab + ink: what an unknown or archived-and-removed app falls back to. */
export const FALLBACK_TONE = { bg: "#F4F3F0", fg: "#1B1A18" };

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
