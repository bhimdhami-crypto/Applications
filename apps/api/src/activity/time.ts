import { IsoDate, addDays, weekday } from '../leave/calendar';

/** Each company's working time zone; dates on the tracker are the employee's local dates */
export const TIME_ZONES: Record<string, string> = {
  KE: 'Africa/Nairobi',
  UG: 'Africa/Kampala',
  TZ: 'Africa/Dar_es_Salaam',
  ZA: 'Africa/Johannesburg',
  EG: 'Africa/Cairo',
  NG: 'Africa/Lagos',
  MX: 'America/Mexico_City',
  NZ: 'Pacific/Auckland',
  US: 'America/New_York',
};

export const zoneOf = (countryCode: string) => TIME_ZONES[countryCode] ?? 'UTC';

/** The local calendar date of a moment in a country, e.g. 2026-10-13 */
export function localDate(countryCode: string, at = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zoneOf(countryCode), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
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
/** Expected hours on a working day */
export const DAY_HOURS = 8;
