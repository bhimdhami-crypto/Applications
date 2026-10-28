import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateStage, Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCandidateDto, CreateOpeningDto, HireCandidateDto, MoveCandidateDto, OpeningQuery, UpdateOpeningDto } from './recruitment.dto';

const STAGES: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
/** Stages a candidate can be moved to by hand; HIRED only happens through hire(), which creates the employee */
const MOVABLE: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'];

const OPENING_SELECT = {
  id: true,
  reference: true,
  title: true,
  department: true,
  workLocation: true,
  employmentType: true,
  grade: true,
  city: true,
  positions: true,
  salaryMin: true,
  salaryMax: true,
  description: true,
  status: true,
  closesOn: true,
  createdAt: true,
  companyId: true,
  company: { select: { name: true, countryCode: true, currency: true } },
  hiringManagerId: true,
  hiringManager: { select: { id: true, firstName: true, lastName: true, jobTitle: true, userId: true } },
} satisfies Prisma.JobOpeningSelect;

/**
 * Job openings and the candidate pipeline. HR runs recruitment; a hiring manager sees
 * the openings they hire for, moves and scores candidates, and can add referrals.
 * Hiring creates the employee record and portal login through the employees service.
 */
@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}

  async listOpenings(actor: AuthUser, query: OpeningQuery = {}) {
    const where: Prisma.JobOpeningWhereInput = {};
    if (query.companyId) where.companyId = query.companyId;
    if (query.status) where.status = query.status;
    if (!this.isHr(actor)) where.hiringManager = { userId: actor.id };
    const openings = await this.prisma.jobOpening.findMany({ where, select: OPENING_SELECT, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
    const counts = await this.prisma.candidate.groupBy({
      by: ['openingId', 'stage'],
      where: { openingId: { in: openings.map((o) => o.id) } },
      _count: { _all: true },
    });
    return openings.map((o) => {
      const pipeline = Object.fromEntries(STAGES.map((s) => [s, counts.find((c) => c.openingId === o.id && c.stage === s)?._count._all ?? 0]));
      return { ...this.view(o), pipeline, candidates: Object.values(pipeline).reduce((a, b) => a + b, 0) };
    });
  }

  async getOpening(actor: AuthUser, id: string) {
    const opening = await this.prisma.jobOpening.findUnique({ where: { id }, select: OPENING_SELECT });
    if (!opening) throw new NotFoundException('Job opening not found');
    this.assertCanSee(actor, opening);
    const candidates = await this.prisma.candidate.findMany({
      where: { openingId: id },
      orderBy: [{ stageChangedAt: 'desc' }],
      include: { employee: { select: { id: true, employeeNo: true } } },
    });
    return { ...this.view(opening), candidates };
  }

  async createOpening(actor: AuthUser, dto: CreateOpeningDto) {
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company) throw new BadRequestException('Unknown company');
    this.checkRange(dto.salaryMin, dto.salaryMax);
    if (dto.hiringManagerId) await this.checkManager(dto.hiringManagerId, company.id);
    const reference = await this.nextReference(company.countryCode);
    const opening = await this.prisma.jobOpening.create({
      data: {
        reference,
        companyId: company.id,
        title: dto.title,
        department: dto.department,
        workLocation: dto.workLocation,
        employmentType: dto.employmentType,
        grade: dto.grade,
        city: dto.city,
        positions: dto.positions ?? 1,
        hiringManagerId: dto.hiringManagerId,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        description: dto.description,
        closesOn: dto.closesOn ? new Date(dto.closesOn) : undefined,
        createdById: actor.id,
      },
      select: OPENING_SELECT,
    });
    await this.audit.record(actor.id, 'recruitment.opening_create', 'JobOpening', opening.id, { reference, title: dto.title });
    return this.view(opening);
  }

  async updateOpening(actor: AuthUser, id: string, dto: UpdateOpeningDto) {
    const existing = await this.prisma.jobOpening.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Job opening not found');
    this.checkRange(dto.salaryMin ?? existing.salaryMin?.toNumber(), dto.salaryMax ?? existing.salaryMax?.toNumber());
    if (dto.hiringManagerId) await this.checkManager(dto.hiringManagerId, existing.companyId);
    const { closesOn, ...rest } = dto;
    const opening = await this.prisma.jobOpening.update({
      where: { id },
      data: { ...rest, ...(closesOn ? { closesOn: new Date(closesOn) } : {}) },
      select: OPENING_SELECT,
    });
    await this.audit.record(actor.id, 'recruitment.opening_update', 'JobOpening', id, { ...dto } as Prisma.InputJsonValue);
    return this.view(opening);
  }

  async addCandidate(actor: AuthUser, openingId: string, dto: CreateCandidateDto) {
    const opening = await this.prisma.jobOpening.findUnique({ where: { id: openingId }, select: OPENING_SELECT });
    if (!opening) throw new NotFoundException('Job opening not found');
    this.assertCanSee(actor, opening);
    if (opening.status !== 'OPEN') throw new BadRequestException('This opening is not taking applications');
    const email = dto.email.toLowerCase();
    if (await this.prisma.candidate.findUnique({ where: { openingId_email: { openingId, email } } })) {
      throw new ConflictException('This person has already applied for this opening');
    }
    const candidate = await this.prisma.candidate.create({
      data: {
        openingId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        source: dto.source ?? (this.isHr(actor) ? 'Careers site' : 'Referral'),
        notes: dto.notes,
      },
    });
    await this.audit.record(actor.id, 'recruitment.candidate_add', 'Candidate', candidate.id, { openingId });
    return candidate;
  }

  async moveCandidate(actor: AuthUser, id: string, dto: MoveCandidateDto) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id }, include: { opening: { select: OPENING_SELECT } } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    this.assertCanSee(actor, candidate.opening);
    if (candidate.stage === 'HIRED') throw new BadRequestException('This candidate has been hired; their record is now an employee profile');
    if (dto.stage && !MOVABLE.includes(dto.stage)) throw new BadRequestException('Use "Hire" to hire a candidate');
    const data: Prisma.CandidateUpdateInput = {};
    if (dto.stage && dto.stage !== candidate.stage) {
      data.stage = dto.stage;
      data.stageChangedAt = new Date();
    }
    if (dto.rating !== undefined) data.rating = dto.rating;
    if (dto.notes !== undefined) data.notes = dto.notes;
    const updated = await this.prisma.candidate.update({ where: { id }, data });
    await this.audit.record(actor.id, 'recruitment.candidate_update', 'Candidate', id, { from: candidate.stage, ...dto } as Prisma.InputJsonValue);
    return updated;
  }

  /** Turns an accepted offer into an employee with a login, reporting to the hiring manager. HR only. */
  async hire(actor: AuthUser, id: string, dto: HireCandidateDto) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id }, include: { opening: true } });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (candidate.stage === 'HIRED') throw new ConflictException('This candidate is already hired');
    if (candidate.stage !== 'OFFER') throw new BadRequestException('Move the candidate to Offer before hiring');
    const o = candidate.opening;
    const employee = await this.employees.create(actor, {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: dto.workEmail ?? candidate.email,
      jobTitle: o.title,
      department: o.department,
      workLocation: o.workLocation,
      employmentType: o.employmentType,
      grade: o.grade ?? undefined,
      city: o.city ?? undefined,
      mobilePhone: candidate.phone ?? undefined,
      hireDate: dto.hireDate,
      monthlyBasic: dto.monthlyBasic,
      monthlyAllowances: dto.monthlyAllowances,
      companyId: o.companyId,
      managerId: o.hiringManagerId ?? undefined,
      role: Role.EMPLOYEE,
    });
    await this.prisma.candidate.update({ where: { id }, data: { stage: 'HIRED', stageChangedAt: new Date(), employeeId: employee.id } });
    const hired = await this.prisma.candidate.count({ where: { openingId: o.id, stage: 'HIRED' } });
    if (hired >= o.positions && o.status === 'OPEN') await this.prisma.jobOpening.update({ where: { id: o.id }, data: { status: 'FILLED' } });
    await this.audit.record(actor.id, 'recruitment.hire', 'Candidate', id, { employeeId: employee.id, employeeNo: employee.employeeNo, openingId: o.id });
    return { employee, filled: hired >= o.positions };
  }

  private view<T extends { salaryMin: Prisma.Decimal | null; salaryMax: Prisma.Decimal | null }>(o: T) {
    return { ...o, salaryMin: o.salaryMin?.toString() ?? null, salaryMax: o.salaryMax?.toString() ?? null };
  }

  private isHr(actor: AuthUser) {
    return actor.role === Role.HR || actor.role === Role.ADMIN;
  }

  private assertCanSee(actor: AuthUser, opening: { hiringManager: { userId: string | null } | null }) {
    if (this.isHr(actor)) return;
    if (opening.hiringManager?.userId !== actor.id) throw new ForbiddenException('Only HR and the hiring manager can see this opening');
  }

  private checkRange(min?: number | null, max?: number | null) {
    if (min != null && max != null && min > max) throw new BadRequestException('The lowest pay must not be above the highest');
  }

  private async checkManager(employeeId: string, companyId: string) {
    const m = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null, status: 'ACTIVE' } });
    if (!m) throw new BadRequestException('Unknown hiring manager');
    if (m.companyId !== companyId) throw new BadRequestException('The hiring manager must work for the same company');
  }

  private async nextReference(countryCode: string) {
    const prefix = `REQ-${countryCode}-`;
    const last = await this.prisma.jobOpening.findFirst({ where: { reference: { startsWith: prefix } }, orderBy: { reference: 'desc' } });
    const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }
}
