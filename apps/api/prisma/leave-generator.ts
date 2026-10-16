import { LeaveStatus, LeaveType, Prisma, PrismaClient } from '@prisma/client';
import { addDays, IsoDate, toIso, workingDays } from '../src/leave/calendar';
import { LEAVE_RULE_PACK, LEAVE_RULES_VERSION } from '../src/leave/leave-rules';
import { publicHolidays } from '../src/leave/public-holidays';
import { rng } from './staff-generator';

const LEAVE_SEED = 20261017;
const YEARS = [2026, 2027];
const iso = (d: Date) => toIso(d);
const date = (s: IsoDate) => new Date(`${s}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Fictional leave history for the generated staff: past annual and sick leave this year, some
 * booked for later in the year, and a few requests still waiting. Also drafts the public holiday
 * calendar for the first-build countries; the other countries get none until HR enters them.
 * Skipped when the group already has leave requests.
 */
export async function generateLeave(prisma: PrismaClient, groupId: string, log: (m: string) => void = () => undefined) {
  const existing = await prisma.leaveRequest.count({ where: { employment: { legalEntity: { groupId } } } });
  if (existing) {
    log('  Leave history already present, skipped.');
    return;
  }
  for (const cc of LEAVE_RULE_PACK.draftHolidayCountries) {
    for (const year of YEARS) {
      const list = publicHolidays(cc, year);
      await prisma.publicHoliday.createMany({ data: list.map((h) => ({ countryCode: cc, date: date(h.date), name: h.name, source: 'DRAFT' })), skipDuplicates: true });
    }
  }

  const entities = await prisma.legalEntity.findMany({ where: { groupId }, select: { id: true, code: true, countryCode: true, weekendDays: true }, orderBy: { code: 'asc' } });
  let total = 0;
  for (const entity of entities) {
    const holidays = new Set(
      (await prisma.publicHoliday.findMany({ where: { countryCode: entity.countryCode, date: { gte: date('2026-01-01'), lte: date('2026-12-31') } }, select: { date: true } })).map((h) => iso(h.date)),
    );
    const staff = await prisma.employment.findMany({
      where: { legalEntityId: entity.id, status: 'ACTIVE', user: null, hireDate: { lt: date('2026-01-01') } },
      select: { id: true },
      orderBy: { employeeNumber: 'asc' },
    });
    const r = rng(LEAVE_SEED + entity.code.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 0));
    const rows: Prisma.LeaveRequestCreateManyInput[] = [];
    const block = (employmentId: string, type: LeaveType, start: IsoDate, len: number, status: LeaveStatus) => {
      const end = addDays(start, len - 1);
      if (end.slice(0, 4) !== start.slice(0, 4)) return;
      const days = workingDays(start, end, entity.weekendDays, holidays).length;
      if (!days) return;
      const decided = status === 'APPROVED' ? { managerAt: date(addDays(start, -7)) } : {};
      rows.push({ employmentId, legalEntityId: entity.id, type, startDate: date(start), endDate: date(end), days, status, rulesVersion: LEAVE_RULES_VERSION, createdAt: date(addDays(start, -14)), ...decided });
    };
    for (const s of staff) {
      // Different months for each block keeps them from overlapping
      const months = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => r.next() - 0.5);
      const annual = r.weighted([[0, 2], [1, 4], [2, 4], [3, 2]] as const);
      for (let i = 0; i < annual; i++) block(s.id, LeaveType.ANNUAL, `2026-${pad(months[i])}-${pad(r.int(1, 20))}`, r.int(2, 7), 'APPROVED');
      if (r.chance(0.3)) block(s.id, LeaveType.SICK, `2026-${pad(months[4])}-${pad(r.int(1, 25))}`, r.int(1, 2), 'APPROVED');
      if (r.chance(0.05)) block(s.id, LeaveType.FAMILY_CARE, `2026-${pad(months[5])}-${pad(r.int(1, 25))}`, 1, 'APPROVED');
      // Some away this month, so the calendar has people on it on the reference date
      if (r.chance(0.15)) block(s.id, r.chance(0.85) ? LeaveType.ANNUAL : LeaveType.SICK, `2026-10-${pad(r.int(1, 27))}`, r.int(1, 5), 'APPROVED');
      const later = r.next();
      if (later < 0.1) block(s.id, LeaveType.ANNUAL, `2026-12-${pad(r.int(14, 21))}`, r.int(3, 9), 'APPROVED');
      else if (later < 0.13) block(s.id, LeaveType.ANNUAL, `2026-11-${pad(r.int(2, 20))}`, r.int(2, 5), 'PENDING_HR');
    }
    await prisma.leaveRequest.createMany({ data: rows });
    total += rows.length;
  }

  // The demo employee: a past holiday, and one waiting for their manager's decision
  const kevin = await prisma.employment.findFirst({ where: { user: { email: 'employee@mindspace.test' } }, select: { id: true, legalEntityId: true } });
  const amina = await prisma.employment.findFirst({ where: { user: { email: 'manager@mindspace.test' } }, select: { id: true } });
  if (kevin && amina) {
    const entity = entities.find((e) => e.id === kevin.legalEntityId)!;
    const holidays = new Set((await prisma.publicHoliday.findMany({ where: { countryCode: entity.countryCode }, select: { date: true } })).map((h) => iso(h.date)));
    const req = (type: LeaveType, start: IsoDate, end: IsoDate, status: LeaveStatus, extra: Partial<Prisma.LeaveRequestCreateManyInput> = {}) => ({
      employmentId: kevin.id,
      legalEntityId: kevin.legalEntityId,
      type,
      startDate: date(start),
      endDate: date(end),
      days: workingDays(start, end, entity.weekendDays, holidays).length,
      status,
      approverId: amina.id,
      rulesVersion: LEAVE_RULES_VERSION,
      ...extra,
    });
    await prisma.leaveRequest.createMany({
      data: [
        req(LeaveType.ANNUAL, '2026-07-13', '2026-07-17', 'APPROVED', { managerAt: date('2026-07-01'), reason: 'Family visit' }),
        req(LeaveType.SICK, '2026-03-09', '2026-03-09', 'APPROVED', { managerAt: date('2026-03-10') }),
        req(LeaveType.ANNUAL, '2026-12-07', '2026-12-11', 'PENDING_MANAGER', { reason: 'Year-end break', handoverTo: 'Team lead on duty' }),
      ],
    });
    total += 3;
  }
  log(`  Leave: ${total} fictional requests, draft holidays for ${LEAVE_RULE_PACK.draftHolidayCountries.join(', ')}.`);
}
