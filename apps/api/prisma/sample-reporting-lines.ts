// Gives the imported sample staff believable reporting lines, so the organisation chart,
// manager approvals and performance reviews have something to show.
//
// In each company and department (active sample staff only, never real logins):
//   - the head is the most senior grade, then the longest-serving;
//   - team leads are other managers and leads at grade G6 or above, and they report to the head;
//   - everyone else is shared out across the leads in employee-number order (or reports to the head).
// It only fills in managers that are missing, so running it twice changes nothing.
import { PrismaClient } from '@prisma/client';

const LEAD_TITLE = /manager|lead|head|director|chief/i;
const gradeNo = (g: string | null) => Number(/\d+/.exec(g ?? '')?.[0] ?? 0);

export async function assignSampleReportingLines(prisma: PrismaClient, log: (msg: string) => void = () => undefined) {
  const staff = await prisma.employee.findMany({
    where: { status: 'ACTIVE', deletedAt: null, userId: null },
    select: { id: true, companyId: true, department: true, grade: true, jobTitle: true, hireDate: true, employeeNo: true, managerId: true },
    orderBy: { employeeNo: 'asc' },
  });
  const groups = new Map<string, typeof staff>();
  for (const e of staff) {
    const key = `${e.companyId}|${e.department}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const assign = new Map<string, string[]>(); // managerId -> employee ids
  const add = (managerId: string, id: string) => assign.set(managerId, [...(assign.get(managerId) ?? []), id]);
  let teams = 0;
  for (const members of groups.values()) {
    if (members.length < 2 || members.some((m) => m.managerId)) continue;
    const ranked = [...members].sort(
      (a, b) => gradeNo(b.grade) - gradeNo(a.grade) || a.hireDate.getTime() - b.hireDate.getTime() || a.employeeNo.localeCompare(b.employeeNo),
    );
    const head = ranked[0];
    // Roughly one lead per twelve people keeps teams a realistic size
    const maxLeads = Math.max(1, Math.round(members.length / 12));
    const leads = ranked.slice(1).filter((m) => gradeNo(m.grade) >= 6 && LEAD_TITLE.test(m.jobTitle)).slice(0, maxLeads);
    const leadIds = new Set(leads.map((l) => l.id));
    for (const l of leads) add(head.id, l.id);
    const rest = members.filter((m) => m.id !== head.id && !leadIds.has(m.id));
    rest.forEach((m, i) => add(leads.length ? leads[i % leads.length].id : head.id, m.id));
    teams += 1;
  }

  let updated = 0;
  for (const [managerId, ids] of assign) {
    const res = await prisma.employee.updateMany({ where: { id: { in: ids }, managerId: null }, data: { managerId } });
    updated += res.count;
  }
  log(`Reporting lines: ${updated} people placed in ${teams} departments`);
  return { updated, teams };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  assignSampleReportingLines(prisma, console.log)
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
