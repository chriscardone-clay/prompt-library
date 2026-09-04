import { nameFromEmail } from "./format";
import type { Person, Profile } from "./types";

const MASKS = ["a", "b", "c", "d"] as const;

/** Terra 200-tint / 500-ink pairs for initials avatars. */
const INITIAL_TONES: { bg: string; fg: string }[] = [
  { bg: "#FCC9AB", fg: "#381005" }, // tangerine
  { bg: "#EEF773", fg: "#102B03" }, // lime
  { bg: "#FBE189", fg: "#372201" }, // lemon
  { bg: "#C8BBFB", fg: "#160038" }, // ube
  { bg: "#BEDFFE", fg: "#001433" }, // blueberry
  { bg: "#AAEBFD", fg: "#002833" }, // slushie
  { bg: "#F8B9E4", fg: "#46022F" }, // dragonfruit
];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Every avatar is masked with one of Terra's organic blob shapes, picked deterministically. */
export function maskFor(person: Pick<Person, "id" | "email">): string {
  const key = person.id ?? person.email;
  return `/avatars/mask-${MASKS[hash(key) % MASKS.length]}.svg`;
}

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

/** SVG data URI with the person's initials on a brand tint, for people without a photo. */
export function initialsAvatar(person: Pick<Person, "id" | "email" | "name">): string {
  const key = person.id ?? person.email;
  const tone = INITIAL_TONES[hash(key) % INITIAL_TONES.length];
  const text = initials(person.name || "", person.email || "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${tone.bg}"/>` +
    `<text x="50" y="50" dy="0.36em" text-anchor="middle" font-family="Roobert, Inter Tight, system-ui, sans-serif" font-weight="600" font-size="42" letter-spacing="-1" fill="${tone.fg}">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function avatarSrc(person: Pick<Person, "id" | "email" | "avatarUrl" | "name">): string {
  return person.avatarUrl || initialsAvatar(person);
}

export function personFromProfile(p: Profile): Person {
  return { id: p.id, email: p.email, name: p.name, avatarUrl: p.avatar_url };
}

export function personFromEmail(email: string): Person {
  return { id: null, email, name: nameFromEmail(email), avatarUrl: null };
}

export const UNKNOWN_PERSON: Person = {
  id: null,
  email: "unknown@clay.com",
  name: "Unknown",
  avatarUrl: null,
};
