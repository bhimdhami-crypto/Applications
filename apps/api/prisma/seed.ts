// Seeds the companies and the six sample accounts used for testing.
// Every email uses the reserved .test domain, so mail only ever lands in the local Mailpit inbox.
import { PrismaClient, Role, WorkLocation } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

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

// The admin is a system account. The other five are Kenya staff paid in KES.
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

  return PEOPLE.map((p) => ({ email: p.email, role: p.role }));
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
