export const APPS = ["Town", "Claude", "ChatGPT", "Claygent", "Monty", "Granola"] as const;
export type App = (typeof APPS)[number];

export const AUDIENCES = ["EPD", "GS", "GTM", "Other"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Tag colours per app — 100 tint background, 400 shade ink (Terra palette). */
export const APP_COLORS: Record<App, { bg: string; fg: string }> = {
  Town: { bg: "#F5F3FF", fg: "#6D4CD6" },
  Claude: { bg: "#FFF3ED", fg: "#B53D0A" },
  ChatGPT: { bg: "#FCFEE2", fg: "#808000" },
  Claygent: { bg: "#F0FCFF", fg: "#008BAD" },
  Monty: { bg: "#FFF0FA", fg: "#CC089E" },
  Granola: { bg: "#FEFAE8", fg: "#9E5802" },
};

/** Apps that have distinct surfaces a prompt can be scoped to. */
export const SURFACES: Partial<Record<App, readonly string[]>> = {
  Claude: ["Chat", "Code", "Cowork"],
  ChatGPT: ["Chat", "Codex", "Work"],
};

export const SORTS = ["top", "new", "updated"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  top: "Top rated",
  new: "Newest",
  updated: "Recently updated",
};

export const ALLOWED_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() || "clay.com";

export function isApp(x: string): x is App {
  return (APPS as readonly string[]).includes(x);
}
export function isAudience(x: string): x is Audience {
  return (AUDIENCES as readonly string[]).includes(x);
}
export function isVisibility(x: string): x is Visibility {
  return (VISIBILITIES as readonly string[]).includes(x);
}
export function isSort(x: string): x is Sort {
  return (SORTS as readonly string[]).includes(x);
}
