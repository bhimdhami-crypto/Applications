import { workingDays } from './calendar';
import { annualDaysFor, annualEntitlement, mexicoAnnualDays, yearsOfService } from './leave-rules';
import { easterSunday, orthodoxEaster, publicHolidays } from './public-holidays';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const dates = (country: string, year: number) => publicHolidays(country, year).map((h) => h.date);

describe('public holidays', () => {
  it('works out Western and Orthodox Easter', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(orthodoxEaster(2026)).toBe('2026-04-12');
    expect(orthodoxEaster(2027)).toBe('2027-05-02');
  });

  it('lists Kenya 2026 holidays', () => {
    expect(dates('KE', 2026)).toEqual(expect.arrayContaining([
      '2026-01-01', '2026-03-20', '2026-04-03', '2026-04-06', '2026-05-01', '2026-06-01',
      '2026-10-10', '2026-10-20', '2026-12-12', '2026-12-25', '2026-12-26',
    ]));
  });

  it('moves Sunday holidays to Monday where the law says so', () => {
    // South Africa: National Women's Day 9 Aug 2026 is a Sunday
    expect(publicHolidays('ZA', 2026)).toContainEqual({ date: '2026-08-10', name: "National Women's Day (observed)" });
    // Tanzania has no such rule: Union Day 26 Apr 2026 stays on the Sunday
    expect(dates('TZ', 2026)).not.toContain('2026-04-27');
  });

  it('Mondayises New Zealand weekend holidays, never onto another holiday', () => {
    expect(dates('NZ', 2026)).toEqual(expect.arrayContaining(['2026-04-27', '2026-12-28'])); // Anzac Sat, Boxing Day Sat
    // 1 and 2 Jan 2028 fall on Saturday and Sunday: observed Monday 3 and Tuesday 4
    expect(dates('NZ', 2028)).toEqual(expect.arrayContaining(['2028-01-03', '2028-01-04']));
  });

  it('uses Mexico’s Monday holidays and Egypt’s Coptic dates', () => {
    expect(dates('MX', 2026)).toEqual(['2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25']);
    expect(dates('EG', 2026)).toEqual(expect.arrayContaining(['2026-01-07', '2026-04-13']));
  });
});

describe('working days', () => {
  it('skips the weekend and holidays', () => {
    // Mon 30 Mar to Fri 10 Apr 2026 in Kenya: 10 weekdays less Good Friday and Easter Monday
    expect(workingDays('2026-03-30', '2026-04-10', 'KE', new Set(dates('KE', 2026)))).toHaveLength(8);
  });

  it('uses a Friday and Saturday weekend in Egypt', () => {
    // Thu 5 to Sun 8 Nov 2026: Thursday and Sunday are working days in Egypt
    expect(workingDays('2026-11-05', '2026-11-08', 'EG', new Set())).toEqual(['2026-11-05', '2026-11-08']);
  });
});

describe('annual leave', () => {
  const ke = (hire: string, dob?: string) => ({ countryCode: 'KE', hireDate: d(hire), dateOfBirth: dob ? d(dob) : null });

  it('counts completed years of service', () => {
    expect(yearsOfService(d('2020-07-01'), d('2026-06-30'))).toBe(5);
    expect(yearsOfService(d('2020-07-01'), d('2026-07-01'))).toBe(6);
  });

  it('gives 21 days, plus 1 for every 2 years, up to 25', () => {
    expect(annualDaysFor(ke('2025-01-01'), 2026)).toBe(21);
    expect(annualDaysFor(ke('2022-01-01'), 2026)).toBe(23);
    expect(annualDaysFor(ke('2010-01-01'), 2026)).toBe(25);
  });

  it('pro-rates the year someone joins', () => {
    expect(annualEntitlement(ke('2026-07-15'), 2026)).toBe(11); // 6 of 12 months of 21 days
    expect(annualEntitlement(ke('2027-01-01'), 2026)).toBe(0);
  });

  it('applies the law where it gives more', () => {
    expect(mexicoAnnualDays(0)).toBe(12);
    expect(mexicoAnnualDays(4)).toBe(20);
    expect(mexicoAnnualDays(5)).toBe(22);
    expect(mexicoAnnualDays(16)).toBe(26);
    expect(annualDaysFor({ countryCode: 'MX', hireDate: d('2009-01-01'), dateOfBirth: null }, 2026)).toBe(26);
    expect(annualDaysFor({ countryCode: 'EG', hireDate: d('2024-01-01'), dateOfBirth: d('1975-05-01') }, 2026)).toBe(30);
    expect(annualDaysFor({ countryCode: 'EG', hireDate: d('2024-01-01'), dateOfBirth: d('1990-05-01') }, 2026)).toBe(22);
  });
});
