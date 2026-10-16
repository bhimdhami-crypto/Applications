import { addDays, generatorWeekend, IsoDate, weekday } from './calendar';

/**
 * Draft public holidays for the eight countries of the first build, generated per year as a
 * starting calendar. The other countries start empty and HR enters their calendar; nothing is
 * guessed for them.
 * Islamic holidays depend on the moon sighting, so their dates are estimates; HR checks
 * each year against the official gazette and adjusts the calendar in the portal.
 */
export interface Holiday {
  date: IsoDate;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): IsoDate => `${y}-${pad(m)}-${pad(d)}`;

/** Western Easter Sunday (anonymous Gregorian algorithm) */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** Orthodox (Coptic) Easter Sunday: Julian computus converted to the Gregorian calendar */
export function orthodoxEaster(year: number): IsoDate {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return addDays(ymd(year, month, day), 13); // Julian to Gregorian offset for 1900-2099
}

/** nth weekday of a month (weekday 0 = Sunday; n = -1 for the last one) */
function nthWeekday(year: number, month: number, dow: number, n: number): IsoDate {
  if (n > 0) {
    const first = ymd(year, month, 1);
    const offset = (dow - weekday(first) + 7) % 7;
    return addDays(first, offset + (n - 1) * 7);
  }
  const last = ymd(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

/** Estimated Islamic holidays (Eid al-Fitr, Eid al-Adha, Islamic New Year, Prophet's Birthday) */
const ISLAMIC: Record<number, { fitr: IsoDate; adha: IsoDate; newYear: IsoDate; mawlid: IsoDate }> = {
  2026: { fitr: '2026-03-20', adha: '2026-05-27', newYear: '2026-06-16', mawlid: '2026-08-25' },
  2027: { fitr: '2027-03-10', adha: '2027-05-16', newYear: '2027-06-06', mawlid: '2027-08-15' },
  2028: { fitr: '2028-02-27', adha: '2028-05-05', newYear: '2028-05-25', mawlid: '2028-08-03' },
};

/** Matariki (New Zealand), set by law for each year */
const MATARIKI: Record<number, IsoDate> = {
  2026: '2026-07-10',
  2027: '2027-06-25',
  2028: '2028-07-14',
};

/**
 * When a holiday falls on a day off, some countries give the next working day instead.
 * Kenya, South Africa and Nigeria move Sunday holidays to Monday; New Zealand moves
 * weekend New Year, Waitangi, Anzac, Christmas and Boxing Day.
 */
const OBSERVED_RULES: Record<string, { days: number[]; names?: string[] }> = {
  KE: { days: [0] },
  ZA: { days: [0] },
  NG: { days: [0] },
  NZ: { days: [6, 0], names: ["New Year's Day", 'Day after New Year', 'Waitangi Day', 'Anzac Day', 'Christmas Day', 'Boxing Day'] },
};

export function publicHolidays(countryCode: string, year: number): Holiday[] {
  const easter = easterSunday(year);
  const goodFriday = { date: addDays(easter, -2), name: 'Good Friday' };
  const easterMonday = { date: addDays(easter, 1), name: 'Easter Monday' };
  const isl = ISLAMIC[year];
  const fitr = isl ? [{ date: isl.fitr, name: 'Eid al-Fitr (estimated)' }] : [];
  const adha = isl ? [{ date: isl.adha, name: 'Eid al-Adha (estimated)' }] : [];
  const fixed = (m: number, d: number, name: string) => ({ date: ymd(year, m, d), name });
  const christmas = [fixed(12, 25, 'Christmas Day'), fixed(12, 26, 'Boxing Day')];

  let list: Holiday[];
  switch (countryCode) {
    case 'KE':
      list = [fixed(1, 1, "New Year's Day"), goodFriday, easterMonday, fixed(5, 1, 'Labour Day'), fixed(6, 1, 'Madaraka Day'),
        fixed(10, 10, 'Mazingira Day'), fixed(10, 20, 'Mashujaa Day'), fixed(12, 12, 'Jamhuri Day'), ...christmas, ...fitr];
      break;
    case 'UG':
      list = [fixed(1, 1, "New Year's Day"), fixed(1, 26, 'Liberation Day'), fixed(2, 16, 'Archbishop Janani Luwum Day'),
        fixed(3, 8, "International Women's Day"), goodFriday, easterMonday, fixed(5, 1, 'Labour Day'), fixed(6, 3, "Martyrs' Day"),
        fixed(6, 9, "National Heroes' Day"), fixed(10, 9, 'Independence Day'), ...christmas, ...fitr, ...adha];
      break;
    case 'TZ':
      list = [fixed(1, 1, "New Year's Day"), fixed(1, 12, 'Zanzibar Revolution Day'), goodFriday, easterMonday,
        fixed(4, 7, 'Karume Day'), fixed(4, 26, 'Union Day'), fixed(5, 1, 'Workers Day'), fixed(7, 7, 'Saba Saba'),
        fixed(8, 8, 'Nane Nane'), fixed(10, 14, 'Nyerere Day'), fixed(12, 9, 'Independence Day'), ...christmas, ...fitr, ...adha,
        ...(isl ? [{ date: isl.mawlid, name: "Prophet's Birthday (estimated)" }] : [])];
      break;
    case 'ZA':
      list = [fixed(1, 1, "New Year's Day"), fixed(3, 21, 'Human Rights Day'), goodFriday, { date: easterMonday.date, name: 'Family Day' },
        fixed(4, 27, 'Freedom Day'), fixed(5, 1, "Workers' Day"), fixed(6, 16, 'Youth Day'), fixed(8, 9, "National Women's Day"),
        fixed(9, 24, 'Heritage Day'), fixed(12, 16, 'Day of Reconciliation'), fixed(12, 25, 'Christmas Day'), fixed(12, 26, 'Day of Goodwill')];
      break;
    case 'EG': {
      const coptic = orthodoxEaster(year);
      list = [fixed(1, 7, 'Coptic Christmas'), fixed(1, 25, 'Revolution and Police Day'), { date: addDays(coptic, 1), name: 'Sham El-Nessim' },
        fixed(4, 25, 'Sinai Liberation Day'), fixed(5, 1, 'Labour Day'), fixed(6, 30, 'June 30 Revolution'), fixed(7, 23, 'Revolution Day'),
        fixed(10, 6, 'Armed Forces Day')];
      if (isl) {
        list.push(
          ...[0, 1, 2].map((n) => ({ date: addDays(isl.fitr, n), name: 'Eid al-Fitr (estimated)' })),
          { date: addDays(isl.adha, -1), name: 'Arafat Day (estimated)' },
          ...[0, 1, 2].map((n) => ({ date: addDays(isl.adha, n), name: 'Eid al-Adha (estimated)' })),
          { date: isl.newYear, name: 'Islamic New Year (estimated)' },
          { date: isl.mawlid, name: "Prophet's Birthday (estimated)" },
        );
      }
      break;
    }
    case 'NG':
      list = [fixed(1, 1, "New Year's Day"), goodFriday, easterMonday, fixed(5, 1, "Workers' Day"), fixed(6, 12, 'Democracy Day'),
        fixed(10, 1, 'Independence Day'), ...christmas, ...fitr, ...adha,
        ...(isl ? [{ date: isl.mawlid, name: "Id el Maulud (estimated)" }] : [])];
      break;
    case 'MX':
      // Mandatory rest days under the Federal Labour Law (article 74)
      list = [fixed(1, 1, "New Year's Day"), { date: nthWeekday(year, 2, 1, 1), name: 'Constitution Day' },
        { date: nthWeekday(year, 3, 1, 3), name: "Benito Juárez's Birthday" }, fixed(5, 1, 'Labour Day'),
        fixed(9, 16, 'Independence Day'), { date: nthWeekday(year, 11, 1, 3), name: 'Revolution Day' }, fixed(12, 25, 'Christmas Day')];
      if (year % 6 === 0) list.push(fixed(10, 1, 'Presidential Inauguration'));
      break;
    case 'NZ':
      list = [fixed(1, 1, "New Year's Day"), fixed(1, 2, 'Day after New Year'), fixed(2, 6, 'Waitangi Day'), goodFriday, easterMonday,
        fixed(4, 25, 'Anzac Day'), { date: nthWeekday(year, 6, 1, 1), name: "King's Birthday" },
        ...(MATARIKI[year] ? [{ date: MATARIKI[year], name: 'Matariki' }] : []),
        { date: nthWeekday(year, 10, 1, 4), name: 'Labour Day' }, ...christmas];
      break;
    default:
      list = [];
  }
  return withObservedDays(countryCode, list).sort((a, b) => a.date.localeCompare(b.date));
}

function withObservedDays(countryCode: string, list: Holiday[]): Holiday[] {
  const rule = OBSERVED_RULES[countryCode];
  // Merge holidays that share a day (e.g. Eid on Labour Day)
  const byDate = new Map<IsoDate, Holiday>();
  for (const h of list) {
    const existing = byDate.get(h.date);
    byDate.set(h.date, existing ? { date: h.date, name: `${existing.name} / ${h.name}` } : h);
  }
  if (!rule) return [...byDate.values()];
  const weekend = generatorWeekend(countryCode);
  const taken = new Set(byDate.keys());
  const extra: Holiday[] = [];
  for (const h of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!rule.days.includes(weekday(h.date))) continue;
    if (rule.names && !rule.names.some((n) => h.name.includes(n))) continue;
    let d = addDays(h.date, 1);
    while (weekend.includes(weekday(d)) || taken.has(d)) d = addDays(d, 1);
    taken.add(d);
    extra.push({ date: d, name: `${h.name} (observed)` });
  }
  return [...byDate.values(), ...extra];
}
