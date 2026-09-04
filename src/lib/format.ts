const DAY = 86_400_000;

/** "today" · "yesterday" · "12 days ago" · "3 months ago" */
export function ago(iso: string | number | Date, now: number = Date.now()): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const days = Math.round((now - t) / DAY);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** "chris.cardone@clay.com" → "Chris Cardone" */
export function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
