/**
 * Event helpers — DESIGN-SYSTEM.md §7.5.
 */
import type { CollectionEntry } from 'astro:content';

export type Event = CollectionEntry<'event'>;

/** End of the event's last day, so an event is still "upcoming" during the day it ends. */
function endOf(event: Event): Date {
  const end = new Date(event.data.endDate ?? event.data.startDate);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * §7.5: "`status` is derived at build from `endDate` vs build date, **not** from her `status`
 * field; her field is a manual override only if it says `past` for something whose date is in
 * the future (a cancellation)."
 */
export function isUpcoming(event: Event, now = new Date()): boolean {
  if (event.data.status === 'past') return false;
  return endOf(event) >= now;
}

/** Upcoming first, soonest first; then past, newest first (§7.5). */
export function splitEvents(events: Event[], now = new Date()) {
  const upcoming = events
    .filter((e) => isUpcoming(e, now))
    .sort((a, b) => +new Date(a.data.startDate) - +new Date(b.data.startDate));
  const past = events
    .filter((e) => !isUpcoming(e, now))
    .sort((a, b) => +new Date(b.data.startDate) - +new Date(a.data.startDate));
  return { upcoming, past };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dd = (d: Date) => String(d.getDate()).padStart(2, '0');

/**
 * §7.5 date block: `04` for one day, `04–05` for a two-day event in one month, and
 * `04 Sep – 02 Oct` when it spans months (which wraps to two lines).
 */
export function dateBlock(event: Event) {
  const start = new Date(event.data.startDate);
  const end = event.data.endDate ? new Date(event.data.endDate) : null;
  const sameMonth = end && start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();

  if (!end || +end === +start) {
    return { day: dd(start), month: MONTHS[start.getMonth()], year: start.getFullYear(), spans: false };
  }
  if (sameMonth) {
    return { day: `${dd(start)}–${dd(end)}`, month: MONTHS[start.getMonth()], year: start.getFullYear(), spans: false };
  }
  return {
    day: `${dd(start)} ${MONTHS[start.getMonth()]} – ${dd(end)} ${MONTHS[end.getMonth()]}`,
    month: null,
    year: start.getFullYear(),
    spans: true,
  };
}

/** `04–05 sep` for the home band's one-line summary. */
export function shortDate(event: Event): string {
  const b = dateBlock(event);
  return b.month ? `${b.day} ${b.month}` : b.day;
}
