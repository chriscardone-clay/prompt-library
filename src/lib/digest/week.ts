/** The digest's clock: weeks run Monday 00:00 → Monday 00:00 in New York. */
export const DIGEST_TZ = "America/New_York";

export interface WeekWindow {
  /** Inclusive start, as an ISO instant. */
  from: string;
  /** Exclusive end, as an ISO instant. */
  to: string;
  /** Calendar date (YYYY-MM-DD) of the Monday the week starts on, in DIGEST_TZ. */
  weekStart: string;
  /** Human range, e.g. "Sep 1 – 7" or "Aug 25 – Sep 1". */
  label: string;
}

/** Local date parts of an instant in a time zone. */
function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/** The instant of local midnight on a calendar date in a time zone. */
function midnightIn(y: number, m: number, d: number, tz: string): Date {
  // Start from the UTC midnight guess and correct by the zone's offset at that moment.
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const local = partsIn(guess, tz);
  const localAsUtc = Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, local.s);
  const offsetMs = localAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The most recent complete Monday→Monday week before `now`. Running on Monday
 * morning yields last week; running mid-week also yields last week.
 */
export function lastCompleteWeek(now = new Date(), tz = DIGEST_TZ): WeekWindow {
  const today = partsIn(now, tz);
  // Days back to this week's Monday (Mon=1 … Sun=0 → 6).
  const sinceMonday = (today.weekday + 6) % 7;
  const thisMonday = midnightIn(today.y, today.m, today.d, tz);
  const thisMondayLocal = new Date(thisMonday.getTime() - sinceMonday * 86400000);
  // Re-anchor to local midnight in case a DST change fell inside the subtraction.
  const tm = partsIn(thisMondayLocal, tz);
  const to = midnightIn(tm.y, tm.m, tm.d, tz);
  const fromGuess = new Date(to.getTime() - 7 * 86400000);
  const fm = partsIn(fromGuess, tz);
  const from = midnightIn(fm.y, fm.m, fm.d, tz);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    weekStart: `${fm.y}-${pad(fm.m)}-${pad(fm.d)}`,
    label: rangeLabel(from, new Date(to.getTime() - 86400000), tz),
  };
}

/** "Sep 1 – 7" within a month, "Aug 25 – Sep 1" across months. */
export function rangeLabel(from: Date, lastDay: Date, tz = DIGEST_TZ): string {
  const md = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "numeric" });
  const a = partsIn(from, tz);
  const b = partsIn(lastDay, tz);
  return a.m === b.m ? `${md.format(from)} – ${d.format(lastDay)}` : `${md.format(from)} – ${md.format(lastDay)}`;
}
