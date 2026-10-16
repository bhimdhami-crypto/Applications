import { ApprovalStage, BenefitKind, Prisma, PrismaClient, RequestStatus, VoucherOccasion, WorkLocation } from '@prisma/client';
import { REFERENCE_DATE, rng } from './staff-generator';

const BENEFITS_SEED = 20261019;
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

/**
 * The first build's meal and gym options for Kenya, in KES a month: draft prices for HR to confirm.
 * Other companies start with none; HR adds their own options in the portal.
 */
export const KE_PLANS: Array<{ kind: BenefitKind; name: string; provider: string; description: string; companyShare: number; employeeShare: number; paidAsCash?: boolean; workLocations: WorkLocation[] }> = [
  { kind: 'MEAL', name: 'Canteen wallet', provider: 'Office canteen', description: 'Monthly credit for meals in the office canteen', companyShare: 4000, employeeShare: 0, workLocations: ['ON_SITE', 'HYBRID'] },
  { kind: 'MEAL', name: 'Partner meal card', provider: 'Partner restaurants', description: 'Card accepted at partner restaurants near the office', companyShare: 4000, employeeShare: 0, workLocations: ['ON_SITE', 'HYBRID'] },
  { kind: 'MEAL', name: 'Remote meal allowance', provider: 'Paid with salary', description: 'Cash allowance for fully remote staff, taxed with pay', companyShare: 3000, employeeShare: 0, paidAsCash: true, workLocations: ['FULLY_REMOTE'] },
  { kind: 'GYM', name: 'Standard', provider: 'Partner gyms', description: 'Gym floor and classes at any partner branch', companyShare: 3000, employeeShare: 2000, workLocations: [] },
  { kind: 'GYM', name: 'Premium', provider: 'Partner gyms', description: 'Adds pool, sauna and personal training sessions', companyShare: 4000, employeeShare: 5000, workLocations: [] },
  { kind: 'GYM', name: 'Family add-on', provider: 'Partner gyms', description: 'Adds one family member; the employee pays it in full', companyShare: 0, employeeShare: 4000, workLocations: [] },
];

/** Kenya's meal and gym options, then fictional memberships and gift vouchers. Skipped when the group already has enrolments. */
export async function generateBenefits(prisma: PrismaClient, groupId: string, log: (m: string) => void = () => undefined) {
  const kenya = await prisma.legalEntity.findMany({ where: { groupId, countryCode: 'KE' }, select: { id: true, code: true, functionalCurrency: true }, orderBy: { code: 'asc' } });
  for (const e of kenya) {
    for (const p of KE_PLANS) {
      await prisma.benefitPlan.upsert({
        where: { legalEntityId_kind_name: { legalEntityId: e.id, kind: p.kind, name: p.name } },
        create: { ...p, legalEntityId: e.id, companyShare: p.companyShare.toFixed(2), employeeShare: p.employeeShare.toFixed(2), paidAsCash: !!p.paidAsCash },
        update: {},
      });
    }
  }
  if (await prisma.benefitEnrolment.count({ where: { employment: { legalEntity: { groupId } } } })) {
    log('  Benefits already present, skipped.');
    return;
  }
  const decided = (stages: ApprovalStage[], on: string, note: string | null = null) =>
    stages.map((stage) => ({ stage, byId: 'demo', byName: 'Demo approver', at: `${on}T09:00:00.000Z`, approved: true, note })) as unknown as Prisma.InputJsonValue;
  const enrolled: ApprovalStage[] = [ApprovalStage.HR, ApprovalStage.PAYROLL];
  let enrolments = 0;
  let vouchers = 0;
  for (const e of kenya) {
    const r = rng(BENEFITS_SEED + e.code.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 0));
    const plans = await prisma.benefitPlan.findMany({ where: { legalEntityId: e.id } });
    const staff = await prisma.employment.findMany({
      where: { legalEntityId: e.id, status: 'ACTIVE', endDate: null, user: null, hireDate: { lt: date('2026-01-01') } },
      select: { id: true, workLocation: true },
      orderBy: { employeeNumber: 'asc' },
    });
    for (const s of staff) {
      const fits = (kind: BenefitKind) => plans.filter((p) => p.kind === kind && (p.workLocations.length === 0 || p.workLocations.includes(s.workLocation)));
      const join = async (kind: BenefitKind) => {
        const plan = r.pick(fits(kind));
        const month = r.int(1, 10);
        const started = monthStart(2026, month);
        await prisma.benefitEnrolment.create({
          data: {
            employmentId: s.id,
            legalEntityId: e.id,
            planId: plan.id,
            kind,
            startDate: started,
            dietaryNeeds: kind === 'MEAL' ? r.pick([null, null, null, 'Vegetarian', 'No pork', 'Halal']) : null,
            branch: kind === 'GYM' ? r.pick(['Westlands', 'Kilimani', 'Upper Hill', 'Mombasa Road']) : null,
            emergencyContact: kind === 'GYM' ? 'Family contact on file' : null,
            status: RequestStatus.APPROVED,
            stages: enrolled,
            decisions: decided(enrolled, `2026-${String(Math.max(1, month - 1)).padStart(2, '0')}-20`),
            createdAt: new Date(started.getTime() - 10 * 86_400_000),
          },
        });
        enrolments++;
      };
      if (r.next() < 0.18) await join('MEAL');
      if (r.next() < 0.08) await join('GYM');
      if (r.next() < 0.03) {
        const month = r.int(1, 9);
        await prisma.giftVoucher.create({
          data: {
            employmentId: s.id,
            legalEntityId: e.id,
            occasion: r.pick(['BIRTHDAY', 'LONG_SERVICE', 'RECOGNITION', 'WEDDING', 'NEW_BABY'] as VoucherOccasion[]),
            value: (r.int(2, 10) * 1000).toFixed(2),
            currency: e.functionalCurrency,
            partner: r.pick([null, 'Partner bookstore', 'Partner supermarket']),
            reason: 'Demo history',
            taxMonth: 202600 + month,
            status: RequestStatus.APPROVED,
            stages: [ApprovalStage.MANAGER, ApprovalStage.HR],
            decisions: decided([ApprovalStage.MANAGER, ApprovalStage.HR], `2026-${String(month).padStart(2, '0')}-10`),
            createdAt: date(`2026-${String(month).padStart(2, '0')}-08`),
          },
        });
        vouchers++;
      }
    }
  }

  // The demo employee has a gym membership and a recognition voucher waiting for HR; a teammate's meal card waits for HR too
  const kevin = await prisma.employment.findFirst({ where: { user: { email: 'employee@mindspace.test' } }, select: { id: true, legalEntityId: true, legalEntity: { select: { functionalCurrency: true } } } });
  const amina = await prisma.employment.findFirst({ where: { user: { email: 'manager@mindspace.test' } }, select: { id: true, userId: true } });
  if (kevin && amina) {
    const standard = await prisma.benefitPlan.findFirst({ where: { legalEntityId: kevin.legalEntityId, kind: 'GYM', name: 'Standard' } });
    if (standard) {
      await prisma.benefitEnrolment.create({
        data: {
          employmentId: kevin.id,
          legalEntityId: kevin.legalEntityId,
          planId: standard.id,
          kind: 'GYM',
          startDate: monthStart(2026, 9),
          branch: 'Westlands',
          emergencyContact: 'Family contact on file',
          status: RequestStatus.APPROVED,
          stages: enrolled,
          decisions: decided(enrolled, '2026-08-25'),
          createdAt: date('2026-08-20'),
        },
      });
      enrolments++;
    }
    await prisma.giftVoucher.create({
      data: {
        employmentId: kevin.id,
        legalEntityId: kevin.legalEntityId,
        occasion: 'RECOGNITION',
        value: '5000.00',
        currency: kevin.legalEntity.functionalCurrency,
        partner: 'Partner bookstore',
        reason: 'Led the release testing for the payroll launch',
        status: RequestStatus.PENDING,
        stages: [ApprovalStage.MANAGER, ApprovalStage.HR],
        stage: ApprovalStage.HR,
        approverId: amina.id,
        decisions: [{ stage: ApprovalStage.MANAGER, byId: amina.userId, byName: 'Amina Mwangi', at: REFERENCE_DATE.toISOString(), approved: true, note: 'Nominated by them' }] as unknown as Prisma.InputJsonValue,
        createdById: amina.userId,
        createdAt: REFERENCE_DATE,
      },
    });
    vouchers++;
    const teammate = await prisma.employment.findFirst({
      where: { legalEntityId: kevin.legalEntityId, status: 'ACTIVE', user: null, workLocation: 'ON_SITE', benefits: { none: {} } },
      select: { id: true },
      orderBy: { employeeNumber: 'asc' },
    });
    const canteen = await prisma.benefitPlan.findFirst({ where: { legalEntityId: kevin.legalEntityId, name: 'Canteen wallet' } });
    if (teammate && canteen) {
      await prisma.benefitEnrolment.create({
        data: {
          employmentId: teammate.id,
          legalEntityId: kevin.legalEntityId,
          planId: canteen.id,
          kind: 'MEAL',
          startDate: monthStart(2026, 10),
          dietaryNeeds: 'Vegetarian',
          status: RequestStatus.PENDING,
          stages: enrolled,
          stage: ApprovalStage.HR,
          createdAt: REFERENCE_DATE,
        },
      });
      enrolments++;
    }
  }
  log(`  Benefits: ${KE_PLANS.length} draft options in each Kenyan company, ${enrolments} meal and gym memberships, ${vouchers} gift vouchers.`);
}
