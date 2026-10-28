// Seeds the companies and the seven sample accounts used for testing.
// Every email uses the reserved .test domain, so mail only ever lands in the local Mailpit inbox.
import { ApprovalStage, BenefitKind, LeaveStatus, LeaveType, LoanKind, LoanProduct, Prisma, PrismaClient, RequestStatus, Role, VoucherOccasion, WorkLocation } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { workingDays } from '../src/leave/calendar';
import { instalmentFor } from '../src/loans/loan-rules';
import { publicHolidays } from '../src/leave/public-holidays';
import { seedLibrary, seedWorkplace } from './seed-workplace';
import { seedTalent } from './seed-talent';

const COMPANIES = [
  { code: 'MSA-INC', name: 'Mindspace Artificial Intelligence Inc.', country: 'United States', countryCode: 'US', currency: 'USD' },
  { code: 'MSA-KE', name: 'Mindspace Artificial Intelligence Kenya Ltd', country: 'Kenya', countryCode: 'KE', currency: 'KES' },
  { code: 'MSA-UG', name: 'Mindspace Artificial Intelligence Uganda Ltd', country: 'Uganda', countryCode: 'UG', currency: 'UGX' },
  { code: 'MSA-TZ', name: 'Mindspace Artificial Intelligence Tanzania Ltd', country: 'Tanzania', countryCode: 'TZ', currency: 'TZS' },
  { code: 'MSA-ZA', name: 'Mindspace Artificial Intelligence South Africa (Pty) Ltd', country: 'South Africa', countryCode: 'ZA', currency: 'ZAR' },
  { code: 'MSA-EG', name: 'Mindspace Artificial Intelligence Egypt S.A.E.', country: 'Egypt', countryCode: 'EG', currency: 'EGP' },
  { code: 'MSA-NG', name: 'Mindspace Artificial Intelligence Nigeria Ltd', country: 'Nigeria', countryCode: 'NG', currency: 'NGN' },
  { code: 'MSA-MX', name: 'Mindspace Inteligencia Artificial Mexico S. de R.L. de C.V.', country: 'Mexico', countryCode: 'MX', currency: 'MXN' },
  { code: 'MSA-NZ', name: 'Mindspace Artificial Intelligence NZ Limited', country: 'New Zealand', countryCode: 'NZ', currency: 'NZD' },
];

type SeedPerson = {
  email: string;
  role: Role;
  employee?: {
    employeeNo: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    department: string;
    workLocation: WorkLocation;
    hireDate: string;
    monthlyBasic: number;
    monthlyAllowances: number;
    reportsTo?: string;
    gender: string;
    dateOfBirth: string;
    mobilePhone: string;
    nextOfKin: { name: string; relationship: string; phone: string };
  };
};

// The admin is a system account. The other six are Kenya staff paid in KES.
const PEOPLE: SeedPerson[] = [
  { email: 'admin@mindspace-ai.test', role: Role.ADMIN },
  {
    email: 'hr@mindspace-ai.test',
    role: Role.HR,
    employee: { employeeNo: 'MSA-KE-T00001', firstName: 'Wanjiru', lastName: 'Kamau', jobTitle: 'HR Business Partner', department: 'People', workLocation: WorkLocation.ON_SITE, hireDate: '2019-03-04', monthlyBasic: 180000, monthlyAllowances: 20000, gender: 'Female', dateOfBirth: '1987-06-14', mobilePhone: '+254 722 100 001', nextOfKin: { name: 'Peter Kamau', relationship: 'Spouse', phone: '+254 733 200 001' } },
  },
  {
    email: 'payroll@mindspace-ai.test',
    role: Role.PAYROLL,
    employee: { employeeNo: 'MSA-KE-T00002', firstName: 'Brian', lastName: 'Otieno', jobTitle: 'Payroll Specialist', department: 'Finance', workLocation: WorkLocation.HYBRID, hireDate: '2020-07-01', monthlyBasic: 150000, monthlyAllowances: 15000, gender: 'Male', dateOfBirth: '1991-02-03', mobilePhone: '+254 722 100 002', nextOfKin: { name: 'Grace Otieno', relationship: 'Mother', phone: '+254 733 200 002' } },
  },
  {
    email: 'manager@mindspace-ai.test',
    role: Role.MANAGER,
    employee: { employeeNo: 'MSA-KE-T00003', firstName: 'Amina', lastName: 'Hassan', jobTitle: 'Engineering Manager', department: 'Engineering', workLocation: WorkLocation.HYBRID, hireDate: '2018-01-15', monthlyBasic: 420000, monthlyAllowances: 50000, gender: 'Female', dateOfBirth: '1984-11-22', mobilePhone: '+254 722 100 003', nextOfKin: { name: 'Yusuf Hassan', relationship: 'Brother', phone: '+254 733 200 003' } },
  },
  {
    email: 'developer@mindspace-ai.test',
    role: Role.EMPLOYEE,
    employee: { employeeNo: 'MSA-KE-T00004', firstName: 'Kevin', lastName: 'Mwangi', jobTitle: 'Software Engineer', department: 'Engineering', workLocation: WorkLocation.FULLY_REMOTE, hireDate: '2022-09-05', monthlyBasic: 230000, monthlyAllowances: 10000, gender: 'Male', dateOfBirth: '1996-04-09', mobilePhone: '+254 722 100 004', nextOfKin: { name: 'Mary Mwangi', relationship: 'Sister', phone: '+254 733 200 004' }, reportsTo: 'manager@mindspace-ai.test' },
  },
  {
    email: 'tester@mindspace-ai.test',
    role: Role.EMPLOYEE,
    employee: { employeeNo: 'MSA-KE-T00005', firstName: 'Faith', lastName: 'Njeri', jobTitle: 'QA Engineer', department: 'Engineering', workLocation: WorkLocation.ON_SITE, hireDate: '2023-02-13', monthlyBasic: 120000, monthlyAllowances: 8000, gender: 'Female', dateOfBirth: '1998-08-30', mobilePhone: '+254 722 100 005', nextOfKin: { name: 'John Njeri', relationship: 'Father', phone: '+254 733 200 005' }, reportsTo: 'manager@mindspace-ai.test' },
  },
  {
    email: 'finance@mindspace-ai.test',
    role: Role.FINANCE,
    employee: { employeeNo: 'MSA-KE-T00006', firstName: 'Lucy', lastName: 'Achieng', jobTitle: 'Finance Manager', department: 'Finance', workLocation: WorkLocation.ON_SITE, hireDate: '2017-05-02', monthlyBasic: 260000, monthlyAllowances: 20000, gender: 'Female', dateOfBirth: '1985-01-19', mobilePhone: '+254 722 100 006', nextOfKin: { name: 'Otieno Achieng', relationship: 'Spouse', phone: '+254 733 200 006' } },
  },
];

export async function seed(prisma: PrismaClient) {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const userPassword = process.env.SEED_USER_PASSWORD;
  if (process.env.NODE_ENV === 'production' && (!adminPassword || !userPassword)) {
    throw new Error('Set SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD before seeding a production database');
  }
  const adminHash = await bcrypt.hash(adminPassword ?? 'Admin#Mindspace2026', 10);
  const userHash = await bcrypt.hash(userPassword ?? 'Test#Mindspace2026', 10);

  for (const c of COMPANIES) {
    await prisma.company.upsert({ where: { code: c.code }, update: { name: c.name, currency: c.currency }, create: c });
  }
  const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });

  const employeeIdByEmail = new Map<string, string>();
  for (const p of PEOPLE) {
    const passwordHash = p.role === Role.ADMIN ? adminHash : userHash;
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: { role: p.role, isActive: true, passwordHash },
      create: { email: p.email, role: p.role, passwordHash },
    });
    if (!p.employee) continue;
    const { reportsTo, hireDate, dateOfBirth, nextOfKin, ...e } = p.employee;
    const data = {
      ...e,
      hireDate: new Date(`${hireDate}T00:00:00Z`),
      dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`),
      workEmail: p.email,
      nationalIdNumber: `SPECIMEN-KE-${e.employeeNo.slice(-5)}`,
      companyId: kenya.id,
      userId: user.id,
      managerId: reportsTo ? employeeIdByEmail.get(reportsTo) ?? null : null,
    };
    // Keyed by login so re-seeding a database seeded with the old MSA-KE-00000x numbers renumbers them
    const emp = await prisma.employee.upsert({ where: { userId: user.id }, update: data, create: data });
    if ((await prisma.nextOfKin.count({ where: { employeeId: emp.id } })) === 0) {
      await prisma.nextOfKin.create({ data: { ...nextOfKin, employeeId: emp.id, isEmergencyContact: true, isBeneficiary: true } });
    }
    employeeIdByEmail.set(p.email, emp.id);
  }

  await seedLeave(prisma, employeeIdByEmail);
  await seedBenefitPlans(prisma, kenya.id);
  await seedMoney(prisma, employeeIdByEmail);
  await seedLibrary(prisma);
  await seedWorkplace(prisma, employeeIdByEmail);
  await seedTalent(prisma, employeeIdByEmail);
  return PEOPLE.map((p) => ({ email: p.email, role: p.role }));
}

/** A little leave history so the leave screens have something to show. Added once per person. */
const SAMPLE_LEAVE: Array<{ email: string; type: LeaveType; start: string; end: string; status: LeaveStatus; reason?: string }> = [
  { email: 'developer@mindspace-ai.test', type: LeaveType.ANNUAL, start: '2026-12-21', end: '2026-12-24', status: LeaveStatus.APPROVED, reason: 'Family holiday' },
  { email: 'developer@mindspace-ai.test', type: LeaveType.SICK, start: '2026-06-15', end: '2026-06-16', status: LeaveStatus.APPROVED },
  { email: 'tester@mindspace-ai.test', type: LeaveType.ANNUAL, start: '2026-11-02', end: '2026-11-06', status: LeaveStatus.PENDING_MANAGER, reason: 'Visiting family in Kisumu' },
  { email: 'manager@mindspace-ai.test', type: LeaveType.ANNUAL, start: '2026-08-10', end: '2026-08-14', status: LeaveStatus.APPROVED },
  { email: 'payroll@mindspace-ai.test', type: LeaveType.STUDY, start: '2026-11-16', end: '2026-11-17', status: LeaveStatus.PENDING_HR, reason: 'CPA exam' },
];

async function seedLeave(prisma: PrismaClient, employeeIdByEmail: Map<string, string>) {
  const holidays = new Set(publicHolidays('KE', 2026).map((h) => h.date));
  const manager = employeeIdByEmail.get('manager@mindspace-ai.test')!;
  for (const email of new Set(SAMPLE_LEAVE.map((l) => l.email))) {
    const employeeId = employeeIdByEmail.get(email)!;
    if ((await prisma.leaveRequest.count({ where: { employeeId } })) > 0) continue;
    for (const l of SAMPLE_LEAVE.filter((x) => x.email === email)) {
      const reportsToManager = email === 'developer@mindspace-ai.test' || email === 'tester@mindspace-ai.test';
      await prisma.leaveRequest.create({
        data: {
          employeeId,
          type: l.type,
          startDate: new Date(`${l.start}T00:00:00Z`),
          endDate: new Date(`${l.end}T00:00:00Z`),
          days: workingDays(l.start, l.end, 'KE', holidays).length,
          reason: l.reason,
          status: l.status,
          approverId: reportsToManager ? manager : null,
          ...(l.status === LeaveStatus.APPROVED ? { managerAt: new Date(`${l.start}T09:00:00Z`) } : {}),
        },
      });
    }
  }
}

/** Kenya's meal and gym options (draft prices for HR to confirm), in KES a month */
const KE_PLANS: Array<{ kind: BenefitKind; name: string; provider: string; description: string; companyShare: number; employeeShare: number; paidAsCash?: boolean; workLocations: WorkLocation[] }> = [
  { kind: BenefitKind.MEAL, name: 'Canteen wallet', provider: 'Office canteen', description: 'Monthly credit for meals in the office canteen', companyShare: 4000, employeeShare: 0, workLocations: [WorkLocation.ON_SITE, WorkLocation.HYBRID] },
  { kind: BenefitKind.MEAL, name: 'Partner meal card', provider: 'Partner restaurants', description: 'Card accepted at partner restaurants near the office', companyShare: 4000, employeeShare: 0, workLocations: [WorkLocation.ON_SITE, WorkLocation.HYBRID] },
  { kind: BenefitKind.MEAL, name: 'Remote meal allowance', provider: 'Paid with salary', description: 'Cash allowance for fully remote staff, taxed with pay', companyShare: 3000, employeeShare: 0, paidAsCash: true, workLocations: [WorkLocation.FULLY_REMOTE] },
  { kind: BenefitKind.GYM, name: 'Standard', provider: 'Partner gyms', description: 'Gym floor and classes at any partner branch', companyShare: 3000, employeeShare: 2000, workLocations: [] },
  { kind: BenefitKind.GYM, name: 'Premium', provider: 'Partner gyms', description: 'Adds pool, sauna and personal training sessions', companyShare: 4000, employeeShare: 5000, workLocations: [] },
  { kind: BenefitKind.GYM, name: 'Family add-on', provider: 'Partner gyms', description: 'Adds one family member; the employee pays it in full', companyShare: 0, employeeShare: 4000, workLocations: [] },
];

async function seedBenefitPlans(prisma: PrismaClient, companyId: string) {
  for (const p of KE_PLANS) {
    const data = { ...p, companyShare: p.companyShare.toFixed(2), employeeShare: p.employeeShare.toFixed(2), paidAsCash: !!p.paidAsCash };
    await prisma.benefitPlan.upsert({ where: { companyId_kind_name: { companyId, kind: p.kind, name: p.name } }, update: {}, create: { ...data, companyId } });
  }
}

/** A loan, an advance, an IOU, two memberships and a voucher nomination, so the screens have something to show. Added once. */
async function seedMoney(prisma: PrismaClient, ids: Map<string, string>) {
  const kevin = ids.get('developer@mindspace-ai.test')!;
  const faith = ids.get('tester@mindspace-ai.test')!;
  const brian = ids.get('payroll@mindspace-ai.test')!;
  const amina = ids.get('manager@mindspace-ai.test')!;
  if ((await prisma.loan.count({ where: { employeeId: { in: [kevin, faith, brian] } } })) > 0) return;
  const users = new Map((await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]));
  const decision = (stage: ApprovalStage, email: string, name: string, at: string, note: string | null = null) => ({ stage, byId: users.get(email)!, byName: name, at: `${at}T09:00:00.000Z`, approved: true, note });
  const json = (v: unknown) => v as Prisma.InputJsonValue;

  await prisma.loan.create({
    data: {
      employeeId: kevin, kind: LoanKind.LOAN, product: LoanProduct.PERSONAL, amount: '150000.00', currency: 'KES', months: 12, interestRate: 5,
      instalment: (instalmentFor(15_000_000, 12, 5) / 100).toFixed(2), recoverable: '150000.00', firstMonth: 202610,
      purpose: 'Laptop and home office setup', guarantor: 'Faith Njeri, MSA-KE-T00005', status: RequestStatus.APPROVED,
      stages: [ApprovalStage.MANAGER, ApprovalStage.HR, ApprovalStage.FINANCE], stage: null, approverId: amina,
      decisions: json([decision(ApprovalStage.MANAGER, 'manager@mindspace-ai.test', 'Amina Hassan', '2026-09-22'), decision(ApprovalStage.HR, 'hr@mindspace-ai.test', 'Wanjiru Kamau', '2026-09-23'), decision(ApprovalStage.FINANCE, 'finance@mindspace-ai.test', 'Lucy Achieng', '2026-09-24')]),
      createdById: users.get('developer@mindspace-ai.test'),
    },
  });
  await prisma.loan.create({
    data: {
      employeeId: faith, kind: LoanKind.ADVANCE, amount: '20000.00', currency: 'KES', months: 1, instalment: '20000.00',
      purpose: 'School fees for my sister', status: RequestStatus.PENDING,
      stages: [ApprovalStage.MANAGER, ApprovalStage.PAYROLL, ApprovalStage.FINANCE], stage: ApprovalStage.MANAGER, approverId: amina,
      createdById: users.get('tester@mindspace-ai.test'),
    },
  });
  await prisma.loan.create({
    data: {
      employeeId: brian, kind: LoanKind.IOU, amount: '15000.00', currency: 'KES', months: 1, instalment: '15000.00',
      purpose: 'Venue deposit for the payroll training day', costCentre: 'FIN-OPS', neededOn: new Date('2026-10-05T00:00:00Z'), settleBy: new Date('2026-10-19T00:00:00Z'),
      status: RequestStatus.APPROVED, stages: [ApprovalStage.FINANCE], stage: null,
      decisions: json([decision(ApprovalStage.FINANCE, 'finance@mindspace-ai.test', 'Lucy Achieng', '2026-10-02')]),
      createdById: users.get('payroll@mindspace-ai.test'),
    },
  });

  const plans = new Map((await prisma.benefitPlan.findMany({ where: { company: { code: 'MSA-KE' } } })).map((p) => [p.name, p.id]));
  const enrolled = [ApprovalStage.HR, ApprovalStage.PAYROLL];
  const enrolDecisions = json([decision(ApprovalStage.HR, 'hr@mindspace-ai.test', 'Wanjiru Kamau', '2026-09-25'), decision(ApprovalStage.PAYROLL, 'payroll@mindspace-ai.test', 'Brian Otieno', '2026-09-26')]);
  await prisma.benefitEnrolment.create({
    data: { employeeId: kevin, planId: plans.get('Standard')!, kind: BenefitKind.GYM, startDate: new Date('2026-10-01T00:00:00Z'), branch: 'Westlands', emergencyContact: 'Mary Mwangi, +254 733 200 004', status: RequestStatus.APPROVED, stages: enrolled, decisions: enrolDecisions, createdById: users.get('developer@mindspace-ai.test') },
  });
  await prisma.benefitEnrolment.create({
    data: { employeeId: faith, planId: plans.get('Canteen wallet')!, kind: BenefitKind.MEAL, startDate: new Date('2026-10-01T00:00:00Z'), dietaryNeeds: 'Vegetarian', status: RequestStatus.APPROVED, stages: enrolled, decisions: enrolDecisions, createdById: users.get('tester@mindspace-ai.test') },
  });
  await prisma.giftVoucher.create({
    data: {
      employeeId: faith, occasion: VoucherOccasion.RECOGNITION, value: '5000.00', currency: 'KES', partner: 'Partner bookstore',
      reason: 'Led the release testing for the payroll launch', status: RequestStatus.PENDING,
      stages: [ApprovalStage.MANAGER, ApprovalStage.HR], stage: ApprovalStage.HR, approverId: amina,
      decisions: json([{ ...decision(ApprovalStage.MANAGER, 'manager@mindspace-ai.test', 'Amina Hassan', '2026-10-12'), note: 'Nominated by them' }]),
      createdById: users.get('manager@mindspace-ai.test'),
    },
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((accounts) => {
      console.log(`Seeded ${COMPANIES.length} companies and ${accounts.length} accounts:`);
      for (const a of accounts) console.log(`  ${a.role.padEnd(8)} ${a.email}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
