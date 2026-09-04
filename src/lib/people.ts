import { nameFromEmail } from "./format";
import type { Person, Profile } from "./types";

const MASKS = ["a", "b", "c", "d"] as const;
const PLACEHOLDER_AVATARS = [
  "/avatars/shapeA.jpg",
  "/avatars/shapeB.jpg",
  "/avatars/shapeC.jpg",
  "/avatars/shapeD.jpg",
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

export function avatarSrc(person: Pick<Person, "id" | "email" | "avatarUrl">): string {
  if (person.avatarUrl) return person.avatarUrl;
  const key = person.id ?? person.email;
  return PLACEHOLDER_AVATARS[hash(key) % PLACEHOLDER_AVATARS.length];
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
