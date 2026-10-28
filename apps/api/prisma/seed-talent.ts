// Example recruitment and performance data so those screens have something to show.
// Added once: skipped when any job opening or review cycle already exists.
import { CandidateStage, EmploymentType, PrismaClient, ReviewStatus, WorkLocation } from '@prisma/client';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export async function seedTalent(prisma: PrismaClient, employeeIdByEmail: Map<string, string>) {
  const kenya = await prisma.company.findUniqueOrThrow({ where: { code: 'MSA-KE' } });
  const nigeria = await prisma.company.findUnique({ where: { code: 'MSA-NG' } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@mindspace-ai.test' } });
  const hr = await prisma.user.findUnique({ where: { email: 'hr@mindspace-ai.test' } });
  const amina = employeeIdByEmail.get('manager@mindspace-ai.test');
  const by = hr?.id ?? admin.id;

  if ((await prisma.jobOpening.count()) === 0) {
    const openings: Array<{
      reference: string; companyId: string; title: string; department: string; workLocation: WorkLocation; employmentType: EmploymentType;
      grade: string; city: string; positions: number; hiringManagerId?: string; salaryMin: string; salaryMax: string; closesOn: string; description: string;
      candidates: Array<[string, string, string, CandidateStage, number | null, string]>;
    }> = [
      {
        reference: 'REQ-KE-0001', companyId: kenya.id, title: 'Senior Machine Learning Engineer', department: 'Engineering',
        workLocation: WorkLocation.HYBRID, employmentType: EmploymentType.PERMANENT, grade: 'G6', city: 'Nairobi', positions: 2,
        hiringManagerId: amina, salaryMin: '380000', salaryMax: '520000', closesOn: '2026-11-30',
        description: 'Build and ship the models behind our document intelligence products. Python, PyTorch and production MLOps.',
        candidates: [
          ['Wairimu', 'Gathoni', 'Referral', CandidateStage.OFFER, 5, 'Strong system design; references checked.'],
          ['Daniel', 'Mutua', 'LinkedIn', CandidateStage.INTERVIEW, 4, 'Good modelling depth, second interview booked.'],
          ['Halima', 'Abdi', 'Careers site', CandidateStage.INTERVIEW, 3, ''],
          ['Joseph', 'Kiprono', 'Agency', CandidateStage.SCREENING, null, ''],
          ['Lucy', 'Wambui', 'Careers site', CandidateStage.APPLIED, null, ''],
          ['Brian', 'Omondi', 'Careers site', CandidateStage.APPLIED, null, ''],
          ['Esther', 'Njeri', 'LinkedIn', CandidateStage.REJECTED, 2, 'Not enough production experience yet.'],
        ],
      },
      {
        reference: 'REQ-KE-0002', companyId: kenya.id, title: 'QA Automation Engineer', department: 'Quality Assurance',
        workLocation: WorkLocation.ON_SITE, employmentType: EmploymentType.FIXED_TERM, grade: 'G4', city: 'Nairobi', positions: 1,
        hiringManagerId: amina, salaryMin: '180000', salaryMax: '240000', closesOn: '2026-11-15',
        description: 'Own the end-to-end test suites for the HR and payroll portal. Playwright and API testing.',
        candidates: [
          ['Kevin', 'Otieno', 'Careers site', CandidateStage.SCREENING, null, 'Portfolio looks good.'],
          ['Mercy', 'Akinyi', 'Referral', CandidateStage.APPLIED, null, ''],
          ['Samuel', 'Kamau', 'Careers site', CandidateStage.APPLIED, null, ''],
        ],
      },
      {
        reference: 'REQ-KE-0003', companyId: kenya.id, title: 'HR Generalist', department: 'Human Resources',
        workLocation: WorkLocation.ON_SITE, employmentType: EmploymentType.PERMANENT, grade: 'G4', city: 'Nairobi', positions: 1,
        salaryMin: '160000', salaryMax: '210000', closesOn: '2026-12-11',
        description: 'Employee relations, onboarding and HR operations for 1,500 staff in Kenya.',
        candidates: [
          ['Grace', 'Wanjiku', 'LinkedIn', CandidateStage.INTERVIEW, 4, ''],
          ['Peter', 'Mwangi', 'Careers site', CandidateStage.SCREENING, null, ''],
        ],
      },
    ];
    if (nigeria) {
      openings.push({
        reference: 'REQ-NG-0001', companyId: nigeria.id, title: 'Customer Success Manager', department: 'Customer Success',
        workLocation: WorkLocation.HYBRID, employmentType: EmploymentType.PERMANENT, grade: 'G5', city: 'Lagos', positions: 1,
        salaryMin: '1200000', salaryMax: '1600000', closesOn: '2026-11-28',
        description: 'Look after our banking customers in West Africa from onboarding to renewal.',
        candidates: [
          ['Chiamaka', 'Okafor', 'Referral', CandidateStage.OFFER, 4, ''],
          ['Tunde', 'Adeyemi', 'LinkedIn', CandidateStage.INTERVIEW, 3, ''],
          ['Ngozi', 'Eze', 'Careers site', CandidateStage.APPLIED, null, ''],
        ],
      });
    }
    for (const { candidates, salaryMin, salaryMax, closesOn, ...o } of openings) {
      await prisma.jobOpening.create({
        data: {
          ...o,
          salaryMin,
          salaryMax,
          closesOn: day(closesOn),
          createdById: by,
          candidates: {
            create: candidates.map(([firstName, lastName, source, stage, rating, notes], i) => ({
              firstName, lastName, source, stage, rating, notes: notes || null,
              email: `${firstName}.${lastName}.${o.reference.slice(-4)}${i}@example.com`.toLowerCase(),
              phone: null,
            })),
          },
        },
      });
    }
  }

  if ((await prisma.reviewCycle.count()) === 0) {
    const people = await prisma.employee.findMany({ where: { companyId: kenya.id, userId: { not: null }, status: 'ACTIVE' }, select: { id: true, managerId: true, workEmail: true } });
    const cycle = await prisma.reviewCycle.create({
      data: {
        name: '2026 mid-year review', companyId: kenya.id, periodStart: day('2026-01-01'), periodEnd: day('2026-06-30'),
        selfDueOn: day('2026-10-30'), managerDueOn: day('2026-11-13'), createdById: by,
      },
    });
    for (const p of people) {
      const submitted = p.workEmail === 'developer@mindspace-ai.test';
      await prisma.performanceReview.create({
        data: {
          cycleId: cycle.id, employeeId: p.id, reviewerId: p.managerId,
          status: submitted ? ReviewStatus.MANAGER_REVIEW : ReviewStatus.SELF_REVIEW,
          ...(submitted ? { selfRating: 4, selfComments: 'Shipped the payslip PDF service and halved payroll run time. Want to lead the next integration.', selfSubmittedAt: day('2026-10-09') } : {}),
        },
      });
    }
    const goals: Array<[string, string, number, number, string]> = [
      ['developer@mindspace-ai.test', 'Ship country payroll rules for Uganda and Tanzania', 40, 100, '2026-09-30'],
      ['developer@mindspace-ai.test', 'Cut payroll run time for 2,000 staff to under a minute', 30, 70, '2026-12-15'],
      ['developer@mindspace-ai.test', 'Mentor two graduate engineers', 30, 50, '2026-12-31'],
      ['tester@mindspace-ai.test', 'Automate regression tests for leave and loans', 50, 60, '2026-11-30'],
      ['tester@mindspace-ai.test', 'Get ISTQB Advanced Test Analyst certification', 50, 20, '2026-12-31'],
      ['manager@mindspace-ai.test', 'Hire two senior ML engineers', 50, 30, '2026-12-31'],
      ['manager@mindspace-ai.test', 'Raise team engagement score to 80%', 50, 65, '2026-12-31'],
    ];
    for (const [email, title, weight, progress, due] of goals) {
      const employeeId = employeeIdByEmail.get(email);
      if (!employeeId) continue;
      await prisma.goal.create({
        data: { employeeId, cycleId: cycle.id, title, weight, progress, status: progress === 100 ? 'COMPLETED' : 'IN_PROGRESS', dueOn: day(due), createdById: by },
      });
    }
  }
}
