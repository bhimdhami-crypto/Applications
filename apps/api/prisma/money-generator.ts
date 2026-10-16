import { ApprovalStage, LoanKind, LoanProduct, Prisma, PrismaClient, RequestStatus } from '@prisma/client';
import { addMonths, instalmentFor, LOAN_PRODUCTS, LOAN_RULES_VERSION, schedule, ymLabel } from '../src/loans/loan-rules';
import { rulesFor } from '../src/payroll/rules';
import { REFERENCE_DATE, rng } from './staff-generator';

const MONEY_SEED = 20261018;
const major = (minor: number) => (minor / 100).toFixed(2);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
/** The last payroll month before the reference date, whose deductions count as repaid */
const LAST_PAID = 202609;

/**
 * Fictional advances, staff loans and IOUs. Advances and loans only where the first build has
 * draft payroll rules to recover them (Kenya, Uganda, Tanzania, South Africa, Egypt, Nigeria,
 * Mexico, New Zealand); IOUs everywhere. Skipped when the group already has loans.
 */
export async function generateMoney(prisma: PrismaClient, groupId: string, log: (m: string) => void = () => undefined) {
  if (await prisma.loan.count({ where: { employment: { legalEntity: { groupId } } } })) {
    log('  Loans already present, skipped.');
    return;
  }
  const entities = await prisma.legalEntity.findMany({ where: { groupId }, select: { id: true, code: true, countryCode: true, functionalCurrency: true }, orderBy: { code: 'asc' } });
  const decided = (stages: ApprovalStage[], on: string) =>
    stages.map((stage) => ({ stage, byId: 'demo', byName: 'Demo approver', at: `${on}T09:00:00.000Z`, approved: true, note: null })) as unknown as Prisma.InputJsonValue;
  let loans = 0;
  for (const entity of entities) {
    const r = rng(MONEY_SEED + entity.code.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 0));
    const recovers = !!rulesFor(entity.countryCode);
    const staff = await prisma.employment.findMany({
      where: { legalEntityId: entity.id, status: 'ACTIVE', endDate: null, user: null, hireDate: { lt: date('2025-10-01') } },
      select: { id: true, employmentType: true, compensation: { where: { effectiveTo: null }, select: { baseAmount: true } } },
      orderBy: { employeeNumber: 'asc' },
    });
    for (const s of staff) {
      const base = Math.round(Number(s.compensation[0]?.baseAmount ?? 0) * 100);
      if (!base) continue;
      const roll = r.next();
      const common = { employmentId: s.id, legalEntityId: entity.id, currency: entity.functionalCurrency, rulesVersion: LOAN_RULES_VERSION };
      if (recovers && roll < 0.06 && s.employmentType === 'PERMANENT') {
        const product = r.weighted([['PERSONAL', 5], ['EDUCATION', 2], ['EMERGENCY', 1], ['VEHICLE', 1], ['HOUSING', 1]] as const) as LoanProduct;
        const months = r.pick([6, 12, 12, 18, 24, 36]);
        const amount = Math.round((base * r.int(5, 20)) / 10 / 100) * 100;
        const rate = LOAN_PRODUCTS[product].yearlyRate;
        const first = addMonths(LAST_PAID, -r.int(0, 10));
        const plan = schedule(amount, months, rate, first);
        const paid = plan.filter((p) => p.month <= LAST_PAID);
        const done = paid.length === plan.length;
        const created = `${Math.floor(first / 100)}-${String(first % 100).padStart(2, '0')}-01`;
        await prisma.loan.create({
          data: {
            ...common,
            kind: LoanKind.LOAN,
            product,
            amount: major(amount),
            months,
            interestRate: rate,
            instalment: major(instalmentFor(amount, months, rate)),
            recoverable: major(amount),
            firstMonth: first,
            purpose: product === 'EDUCATION' ? 'Course fees' : product === 'VEHICLE' ? 'Car purchase' : product === 'HOUSING' ? 'Home deposit' : product === 'EMERGENCY' ? 'Medical bills' : 'Family needs',
            status: done ? RequestStatus.CLOSED : RequestStatus.APPROVED,
            stages: [ApprovalStage.HR, ApprovalStage.FINANCE],
            decisions: decided([ApprovalStage.HR, ApprovalStage.FINANCE], created),
            createdAt: date(created),
            repayments: {
              create: paid.map((p) => ({
                year: Math.floor(p.month / 100),
                month: p.month % 100,
                amount: major(p.payment),
                principal: major(p.principal),
                interest: major(p.interest),
                source: 'PAYROLL',
                note: `Demo history, ${ymLabel(p.month)}`,
              })),
            },
          },
        });
        loans++;
      } else if (recovers && roll < 0.09) {
        const month = addMonths(LAST_PAID, -r.int(0, 8));
        const amount = Math.round((base * r.int(1, 4)) / 10 / 100) * 100;
        await prisma.loan.create({
          data: {
            ...common,
            kind: LoanKind.ADVANCE,
            amount: major(amount),
            instalment: major(amount),
            recoverable: major(amount),
            firstMonth: month,
            purpose: r.pick(['School fees', 'Rent deposit', 'Medical bill', 'Family emergency']),
            status: RequestStatus.CLOSED,
            stages: [ApprovalStage.PAYROLL, ApprovalStage.FINANCE],
            decisions: decided([ApprovalStage.PAYROLL, ApprovalStage.FINANCE], `${Math.floor(month / 100)}-${String(month % 100).padStart(2, '0')}-05`),
            createdAt: date(`${Math.floor(month / 100)}-${String(month % 100).padStart(2, '0')}-03`),
            repayments: { create: [{ year: Math.floor(month / 100), month: month % 100, amount: major(amount), principal: major(amount), source: 'PAYROLL' }] },
          },
        });
        loans++;
      } else if (roll < 0.1) {
        const needed = `2026-${String(r.int(3, 9)).padStart(2, '0')}-${String(r.int(1, 15)).padStart(2, '0')}`;
        const amount = r.int(20, 200) * 100 * Math.max(1, Math.round(base / 10_000_000));
        const spent = Math.round(amount * (0.7 + r.next() * 0.3));
        await prisma.loan.create({
          data: {
            ...common,
            kind: LoanKind.IOU,
            amount: major(amount),
            instalment: '0',
            purpose: r.pick(['Client workshop supplies', 'Field visit transport', 'Office repairs', 'Event catering']),
            costCentre: `CC-${r.int(100, 999)}`,
            neededOn: date(needed),
            settleBy: new Date(date(needed).getTime() + 14 * 86_400_000),
            spent: major(spent),
            cashReturned: major(amount - spent),
            settledAt: new Date(date(needed).getTime() + 10 * 86_400_000),
            status: RequestStatus.CLOSED,
            stages: [ApprovalStage.FINANCE],
            decisions: decided([ApprovalStage.FINANCE], needed),
            createdAt: date(needed),
          },
        });
        loans++;
      }
    }
  }

  // The demo employee: a personal loan being repaid, and an advance waiting for their manager
  const kevin = await prisma.employment.findFirst({
    where: { user: { email: 'employee@mindspace.test' } },
    select: { id: true, legalEntityId: true, legalEntity: { select: { functionalCurrency: true } }, compensation: { where: { effectiveTo: null }, select: { baseAmount: true } } },
  });
  const amina = await prisma.employment.findFirst({ where: { user: { email: 'manager@mindspace.test' } }, select: { id: true } });
  if (kevin && amina) {
    const base = Math.round(Number(kevin.compensation[0]?.baseAmount ?? 0) * 100);
    const amount = Math.round(base / 100) * 100;
    const plan = schedule(amount, 12, 5, 202605);
    const common = { employmentId: kevin.id, legalEntityId: kevin.legalEntityId, currency: kevin.legalEntity.functionalCurrency, rulesVersion: LOAN_RULES_VERSION };
    await prisma.loan.create({
      data: {
        ...common,
        kind: LoanKind.LOAN,
        product: LoanProduct.PERSONAL,
        amount: major(amount),
        months: 12,
        interestRate: 5,
        instalment: major(instalmentFor(amount, 12, 5)),
        recoverable: major(amount),
        firstMonth: 202605,
        purpose: 'Home furniture',
        status: RequestStatus.APPROVED,
        stages: [ApprovalStage.MANAGER, ApprovalStage.HR, ApprovalStage.FINANCE],
        approverId: amina.id,
        decisions: decided([ApprovalStage.MANAGER, ApprovalStage.HR, ApprovalStage.FINANCE], '2026-04-20'),
        createdAt: date('2026-04-15'),
        repayments: {
          create: plan
            .filter((p) => p.month <= LAST_PAID)
            .map((p) => ({ year: Math.floor(p.month / 100), month: p.month % 100, amount: major(p.payment), principal: major(p.principal), interest: major(p.interest), source: 'PAYROLL' })),
        },
      },
    });
    const advance = Math.round(base / 5 / 100) * 100;
    await prisma.loan.create({
      data: {
        ...common,
        kind: LoanKind.ADVANCE,
        amount: major(advance),
        instalment: major(advance),
        purpose: 'Car repair',
        status: RequestStatus.PENDING,
        stages: [ApprovalStage.MANAGER, ApprovalStage.PAYROLL, ApprovalStage.FINANCE],
        stage: ApprovalStage.MANAGER,
        approverId: amina.id,
        createdAt: REFERENCE_DATE,
      },
    });
    loans += 2;
  }
  log(`  Advances, loans and IOUs: ${loans} fictional requests.`);
}
