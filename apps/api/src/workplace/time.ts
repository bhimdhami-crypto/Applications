import { addDays, IsoDate, weekday } from '../leave/calendar';

/** The local calendar date of a moment in a time zone, e.g. 2026-10-16 */
export function localDate(timeZone: string, at = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Monday of the week a date falls in */
export function mondayOf(date: IsoDate): IsoDate {
  const dow = weekday(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** Whole minutes between two moments */
export const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

/** A session left open this long is closed automatically */
export const MAX_SESSION_HOURS = 16;
/** Where an automatically closed session ends: a normal day's length after clock-in */
export const AUTO_CLOSE_HOURS = 9;
/** Expected hours on a working day, for the tracker's totals only (not a contractual rule) */
export const DAY_HOURS = 8;
/** How far back an employee may correct their own times and notes */
export const EDIT_DAYS = 7;
