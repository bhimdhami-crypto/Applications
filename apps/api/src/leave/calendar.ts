/**
 * Calendar helpers for leave: dates are handled as 'YYYY-MM-DD' strings at UTC midnight,
 * so a day never shifts with the server's time zone.
 */
export type IsoDate = string;

export const toIso = (d: Date): IsoDate => d.toISOString().slice(0, 10);
export const fromIso = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: IsoDate, n: number): IsoDate => {
  const d = fromIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};
export const weekday = (s: IsoDate) => fromIso(s).getUTCDay(); // 0 = Sunday

/** Weekend days by country. Egypt's working week runs Sunday to Thursday. */
export function weekendDays(countryCode: string): number[] {
  return countryCode === 'EG' ? [5, 6] : [6, 0];
}

export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Working days between two dates (inclusive), skipping the country's weekend and public holidays. */
export function workingDays(start: IsoDate, end: IsoDate, countryCode: string, holidays: Set<IsoDate>): IsoDate[] {
  const weekend = weekendDays(countryCode);
  return eachDay(start, end).filter((d) => !weekend.includes(weekday(d)) && !holidays.has(d));
}
