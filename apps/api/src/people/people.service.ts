import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can, currencyDecimals } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { assertEntity, entityFilter, entityIds } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { decryptField, fieldKey, masked } from '../common/field-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { avatarSvg } from './avatar';
import { inForce, PeopleAccess, Relation, Subject, today } from './people-access.service';
import {
  CreateEmployeeDto,
  EmployeeListQuery,
  HeadcountQuery,
  NewAssignmentDto,
  NewCompensationDto,
  ReplaceContactsDto,
  SELF_EDITABLE,
  TerminateDto,
  UpdateEmploymentDto,
  UpdatePersonalDto,
} from './people.dto';

const date = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);

const listSelect = (on: Date) =>
  ({
    id: true,
    employeeNumber: true,
    status: true,
    hireDate: true,
    endDate: true,
    workEmail: true,
    legalEntity: { select: { id: true, code: true, name: true, countryCode: true } },
    person: { select: { id: true, firstName: true, lastName: true, localName: true, preferredName: true } },
    assignments: {
      where: inForce(on),
      take: 1,
      select: {
        jobTitle: true,
        grade: { select: { code: true } },
        department: { select: { id: true, name: true } },
        manager: { select: { id: true, person: { select: { firstName: true, lastName: true } } } },
      },
    },
  }) satisfies Prisma.EmploymentSelect;

type ListRow = Prisma.EmploymentGetPayload<{ select: ReturnType<typeof listSelect> }>;

const assignmentInclude = {
  grade: { select: { code: true, name: true } },
  businessUnit: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, city: true } },
  costCentre: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, employeeNumber: true, person: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.AssignmentInclude;

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

@Injectable()
export class PeopleService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PeopleAccess,
  ) {}

  onModuleInit() {
    fieldKey(); // fail at start-up, not on first use, when production has no encryption key
    // Leavers with a future leaving date stay active until that day; check a few times a day
    this.timer = setInterval(() => void this.closeEnded().catch(() => undefined), 6 * 3600_000);
    this.timer.unref();
    void this.closeEnded().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Marks employments whose leaving date has passed as terminated */
  closeEnded() {
    return this.prisma.employment.updateMany({ where: { status: 'ACTIVE', endDate: { lte: today() } }, data: { status: 'TERMINATED' } });
  }

  private presentListRow(r: ListRow) {
    const a = r.assignments[0];
    return {
      id: r.id,
      employeeNumber: r.employeeNumber,
      name: fullName(r.person),
      localName: r.person.localName,
      personId: r.person.id,
      status: r.status,
      hireDate: r.hireDate,
      endDate: r.endDate,
      workEmail: r.workEmail,
      entity: r.legalEntity,
      jobTitle: a?.jobTitle ?? null,
      grade: a?.grade?.code ?? null,
      department: a?.department ?? null,
      manager: a?.manager ? { id: a.manager.id, name: fullName(a.manager.person) } : null,
    };
  }

  // ───── Lists ─────

  async list(auth: AuthContext, q: EmployeeListQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    if (q.entityId) assertEntity(auth, 'people.read', q.entityId, 'Company');
    const on = today();
    const where: Prisma.EmploymentWhereInput = {
      legalEntity: { groupId: auth.groupId },
      legalEntityId: q.entityId ?? entityFilter(auth, 'people.read'),
      ...(q.status === 'ALL' ? {} : { status: q.status ?? 'ACTIVE' }),
      ...(q.departmentId ? { assignments: { some: { departmentId: q.departmentId, ...inForce(on) } } } : {}),
      ...(q.q
        ? {
            OR: [
              { employeeNumber: { contains: q.q, mode: 'insensitive' } },
              { workEmail: { contains: q.q, mode: 'insensitive' } },
              { person: { firstName: { contains: q.q, mode: 'insensitive' } } },
              { person: { lastName: { contains: q.q, mode: 'insensitive' } } },
              { person: { localName: { contains: q.q } } },
              ...this.fullNameSearch(q.q),
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.employment.count({ where }),
      this.prisma.employment.findMany({
        where,
        select: listSelect(on),
        orderBy: [{ person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }, { employeeNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.presentListRow(r)) };
  }

  /** "Amina Mwangi" matches first and last name together */
  private fullNameSearch(q: string): Prisma.EmploymentWhereInput[] {
    const parts = q.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return [];
    const first = parts[0];
    const last = parts.slice(1).join(' ');
    return [{ person: { firstName: { contains: first, mode: 'insensitive' }, lastName: { contains: last, mode: 'insensitive' } } }];
  }

  async team(auth: AuthContext) {
    const depths = await this.access.team(auth);
    const rows = await this.prisma.employment.findMany({
      where: { id: { in: [...depths.keys()] } },
      select: listSelect(today()),
      orderBy: [{ person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }],
    });
    return rows.map((r) => ({ ...this.presentListRow(r), level: depths.get(r.id) ?? 1 }));
  }

  /** The caller's own employment records, newest first */
  async mine(auth: AuthContext) {
    const rows = await this.prisma.employment.findMany({
      where: { userId: auth.userId },
      select: listSelect(today()),
      orderBy: { hireDate: 'desc' },
    });
    return rows.map((r) => this.presentListRow(r));
  }

  /** Active headcount by company and department, as of today, within the caller's scope */
  async headcount(auth: AuthContext, q: HeadcountQuery) {
    if (q.entityId) assertEntity(auth, 'people.read', q.entityId, 'Company');
    const ids = q.entityId ? [q.entityId] : entityIds(auth, 'people.read');
    const entities = await this.prisma.legalEntity.findMany({
      where: { id: { in: ids }, groupId: auth.groupId },
      select: { id: true, code: true, name: true, countryCode: true, departments: { select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } } },
      orderBy: [{ countryCode: 'asc' }, { code: 'asc' }],
    });
    const byDept = await this.prisma.assignment.groupBy({
      by: ['legalEntityId', 'departmentId'],
      where: { legalEntityId: { in: ids }, ...inForce(), employment: { status: 'ACTIVE' } },
      _count: { _all: true },
    });
    const left = await this.prisma.employment.groupBy({ by: ['legalEntityId'], where: { legalEntityId: { in: ids }, status: 'TERMINATED' }, _count: { _all: true } });
    const companies = entities.map((e) => {
      const rows = byDept.filter((r) => r.legalEntityId === e.id);
      return {
        id: e.id,
        code: e.code,
        name: e.name,
        countryCode: e.countryCode,
        active: rows.reduce((s, r) => s + r._count._all, 0),
        left: left.find((l) => l.legalEntityId === e.id)?._count._all ?? 0,
        departments: e.departments.map((d) => ({ ...d, active: rows.find((r) => r.departmentId === d.id)?._count._all ?? 0 })).filter((d) => d.active > 0),
      };
    });
    const countries = [...new Set(companies.map((c) => c.countryCode))].map((cc) => ({
      countryCode: cc,
      active: companies.filter((c) => c.countryCode === cc).reduce((s, c) => s + c.active, 0),
      left: companies.filter((c) => c.countryCode === cc).reduce((s, c) => s + c.left, 0),
    }));
    return { asOf: today(), total: companies.reduce((s, c) => s + c.active, 0), countries, companies };
  }

  // ───── One record ─────

  /** What the caller may do with this record; the web hides controls with it, the API enforces each one */
  private permissions(auth: AuthContext, s: Subject, rel: Relation) {
    const e = s.legalEntityId;
    const hrManage = can(auth.access, 'people.manage', e);
    const sensitive = can(auth.access, 'people.sensitive.read', e);
    return {
      viewPersonal: rel.hr || rel.self,
      editPersonal: rel.self || hrManage,
      editNames: hrManage,
      editJob: hrManage,
      viewPay: rel.self || sensitive || can(auth.access, 'payroll.read', e),
      editPay: hrManage && sensitive,
      revealSensitive: rel.self || sensitive,
      viewDocuments: rel.hr || rel.self,
      uploadDocuments: rel.self || hrManage,
      verifyDocuments: hrManage,
      requestBankChange: rel.self,
      terminate: hrManage && s.status === 'ACTIVE',
    };
  }

  async get(auth: AuthContext, id: string) {
    const { subject, rel } = await this.access.resolve(auth, id);
    const allowed = this.permissions(auth, subject, rel);
    const e = await this.prisma.employment.findUniqueOrThrow({
      where: { id },
      include: {
        legalEntity: { select: { id: true, code: true, name: true, countryCode: true, functionalCurrency: true } },
        person: { include: { contacts: { orderBy: { createdAt: 'asc' } } } },
        assignments: { where: inForce(), take: 1, include: assignmentInclude },
        _count: { select: { reports: { where: { ...inForce(), employment: { status: 'ACTIVE' } } } } },
      },
    });
    const p = e.person;
    const job = e.assignments[0] ?? (await this.prisma.assignment.findFirst({ where: { employmentId: id }, orderBy: { effectiveFrom: 'desc' }, include: assignmentInclude }));
    const personal = allowed.viewPersonal
      ? {
          gender: p.gender,
          dateOfBirth: p.dateOfBirth,
          nationality: p.nationality,
          maritalStatus: p.maritalStatus,
          dependants: p.dependants,
          personalEmail: p.personalEmail,
          mobilePhone: p.mobilePhone,
          highestQualification: p.highestQualification,
          institution: p.institution,
          qualificationYear: p.qualificationYear,
          contacts: p.contacts.map(({ personId, ...c }) => c),
        }
      : null;
    return {
      id: e.id,
      employeeNumber: e.employeeNumber,
      status: e.status,
      employmentType: e.employmentType,
      workLocation: e.workLocation,
      hireDate: e.hireDate,
      probationEndDate: allowed.viewPersonal ? e.probationEndDate : null,
      endDate: e.endDate,
      exitReason: allowed.viewPersonal ? e.exitReason : null,
      workEmail: e.workEmail,
      hasAccount: !!e.userId,
      entity: e.legalEntity,
      person: { id: p.id, personNumber: p.personNumber, firstName: p.firstName, lastName: p.lastName, localName: p.localName, preferredName: p.preferredName, hasPhoto: !!p.photoKey },
      personal,
      job: job ? this.presentAssignment(job) : null,
      directReports: e._count.reports,
      relation: rel.hr ? 'HR' : rel.self ? 'SELF' : 'MANAGER',
      can: allowed,
    };
  }

  private presentAssignment(a: Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>) {
    return {
      id: a.id,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
      reason: a.reason,
      jobTitle: a.jobTitle,
      grade: a.grade,
      businessUnit: a.businessUnit,
      department: a.department,
      branch: a.branch,
      costCentre: a.costCentre,
      manager: a.manager ? { id: a.manager.id, employeeNumber: a.manager.employeeNumber, name: fullName(a.manager.person) } : null,
      fte: a.fte.toString(),
    };
  }

  async history(auth: AuthContext, id: string) {
    const { subject, rel } = await this.access.resolve(auth, id);
    const allowed = this.permissions(auth, subject, rel);
    if (!allowed.viewPersonal) throw new NotFoundException('Employee not found');
    const assignments = await this.prisma.assignment.findMany({ where: { employmentId: id }, orderBy: { effectiveFrom: 'desc' }, include: assignmentInclude });
    return { assignments: assignments.map((a) => this.presentAssignment(a)) };
  }

  /** Pay and bank details. Masked numbers only; revealing one is a separate, audited call. */
  async pay(auth: AuthContext, id: string) {
    const { subject, rel } = await this.access.resolve(auth, id);
    if (!this.permissions(auth, subject, rel).viewPay) throw new NotFoundException('Employee not found');
    const [compensation, bankAccounts, identifiers] = await Promise.all([
      this.prisma.compensation.findMany({ where: { employmentId: id }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.bankAccount.findMany({ where: { employmentId: id }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.personIdentifier.findMany({ where: { personId: subject.personId }, orderBy: { kind: 'asc' } }),
    ]);
    if (!rel.self) await this.audit.record(auth, { action: 'people.pay.viewed', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId });
    return {
      compensation: compensation.map((c) => ({ ...c, baseAmount: c.baseAmount.toString(), allowances: c.allowances.toString() })),
      bankAccounts: bankAccounts.map(({ accountNumberEncrypted, accountNumberLast4, ...b }) => ({ ...b, accountNumber: masked(accountNumberLast4) })),
      identifiers: identifiers.map(({ valueEncrypted, valueLast4, personId, ...i }) => ({ ...i, value: masked(valueLast4) })),
    };
  }

  async reveal(auth: AuthContext, id: string, kind: 'identifier' | 'bank', itemId: string) {
    const { subject, rel } = await this.access.resolve(auth, id);
    if (!this.permissions(auth, subject, rel).revealSensitive) throw new ForbiddenException('You cannot see full identity or bank numbers');
    let value: string;
    if (kind === 'identifier') {
      const row = await this.prisma.personIdentifier.findFirst({ where: { id: itemId, personId: subject.personId } });
      if (!row) throw new NotFoundException('Identifier not found');
      value = decryptField(row.valueEncrypted);
    } else {
      const row = await this.prisma.bankAccount.findFirst({ where: { id: itemId, employmentId: id } });
      if (!row) throw new NotFoundException('Bank account not found');
      value = decryptField(row.accountNumberEncrypted);
    }
    await this.audit.record(auth, { action: `people.${kind}.revealed`, targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { itemId } });
    return { value };
  }

  async photo(auth: AuthContext, id: string) {
    const { subject } = await this.access.resolve(auth, id);
    const p = await this.prisma.person.findUniqueOrThrow({ where: { id: subject.personId }, select: { id: true, firstName: true, lastName: true, photoKey: true } });
    return { photoKey: p.photoKey, svg: avatarSvg(p.id, p.firstName, p.lastName) };
  }

  // ───── Hire ─────

  async create(auth: AuthContext, dto: CreateEmployeeDto) {
    assertEntity(auth, 'people.manage', dto.legalEntityId, 'Company');
    if (dto.baseAmount && !can(auth.access, 'people.sensitive.read', dto.legalEntityId)) throw new ForbiddenException('You cannot set pay for this company');
    const entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id: dto.legalEntityId } });
    const hireDate = date(dto.hireDate);
    const org = await this.checkOrg(auth, dto.legalEntityId, dto);
    if (dto.baseAmount) this.checkMoney(dto.baseAmount, entity.functionalCurrency);
    if (dto.allowances) this.checkMoney(dto.allowances, entity.functionalCurrency);

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx, entity.countryCode);
      const person = await tx.person.create({
        data: {
          groupId: auth.groupId,
          personNumber: `P-${entity.countryCode}-${number}`,
          firstName: dto.firstName,
          lastName: dto.lastName,
          localName: dto.localName,
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirth ? date(dto.dateOfBirth) : null,
          nationality: dto.nationality,
          personalEmail: dto.personalEmail,
          mobilePhone: dto.mobilePhone,
        },
      });
      const employment = await tx.employment.create({
        data: {
          personId: person.id,
          legalEntityId: entity.id,
          employeeNumber: `MSA-${entity.countryCode}-${number}`,
          workEmail: dto.workEmail?.toLowerCase(),
          employmentType: dto.employmentType,
          workLocation: dto.workLocation,
          hireDate,
          probationEndDate: new Date(Date.UTC(hireDate.getUTCFullYear(), hireDate.getUTCMonth() + 6, hireDate.getUTCDate())),
        },
      });
      await tx.assignment.create({ data: { employmentId: employment.id, legalEntityId: entity.id, effectiveFrom: hireDate, reason: 'HIRE', jobTitle: dto.jobTitle, ...org, createdById: auth.userId } });
      if (dto.baseAmount) {
        await tx.compensation.create({
          data: { employmentId: employment.id, legalEntityId: entity.id, effectiveFrom: hireDate, currency: entity.functionalCurrency, baseAmount: dto.baseAmount, allowances: dto.allowances ?? '0', reason: 'HIRE', createdById: auth.userId },
        });
      }
      await this.audit.record(auth, { action: 'people.hired', targetType: 'employment', targetId: employment.id, legalEntityId: entity.id, detail: { employeeNumber: employment.employeeNumber, hireDate: dto.hireDate } }, tx);
      return employment;
    });
    return this.get(auth, created.id);
  }

  /** The next free six-digit number for a country's employees */
  private async nextNumber(tx: Prisma.TransactionClient, countryCode: string) {
    // Serialise hires per country so two at once cannot take the same number
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-number:${countryCode}`}))`;
    const last = await tx.employment.findFirst({ where: { employeeNumber: { startsWith: `MSA-${countryCode}-` } }, orderBy: { employeeNumber: 'desc' }, select: { employeeNumber: true } });
    const n = last ? Number(last.employeeNumber.split('-').pop()) + 1 : 1;
    return String(n).padStart(6, '0');
  }

  /** Grade, department, branch, cost centre and manager must exist and belong to the company */
  private async checkOrg(
    auth: AuthContext,
    legalEntityId: string,
    dto: { gradeCode?: string; departmentId?: string; branchId?: string; costCentreId?: string; managerId?: string },
    employmentId?: string,
  ) {
    const out: { gradeId?: string | null; businessUnitId?: string | null; departmentId?: string | null; branchId?: string | null; costCentreId?: string | null; managerId?: string | null } = {};
    if (dto.gradeCode !== undefined) {
      const g = await this.prisma.jobGrade.findFirst({ where: { groupId: auth.groupId, code: dto.gradeCode } });
      if (!g) throw new BadRequestException(`Unknown grade ${dto.gradeCode}`);
      out.gradeId = g.id;
    }
    if (dto.departmentId !== undefined) {
      const d = await this.prisma.department.findFirst({ where: { id: dto.departmentId, legalEntityId } });
      if (!d) throw new BadRequestException('That department is not in this company');
      out.departmentId = d.id;
      out.businessUnitId = d.businessUnitId;
      // Default the cost centre to the department's own when none is given
      if (dto.costCentreId === undefined) {
        const cc = await this.prisma.costCentre.findFirst({ where: { departmentId: d.id, legalEntityId }, orderBy: { code: 'asc' } });
        out.costCentreId = cc?.id ?? null;
      }
    }
    if (dto.branchId !== undefined) {
      if (!(await this.prisma.branch.findFirst({ where: { id: dto.branchId, legalEntityId } }))) throw new BadRequestException('That branch is not in this company');
      out.branchId = dto.branchId;
    }
    if (dto.costCentreId !== undefined) {
      if (!(await this.prisma.costCentre.findFirst({ where: { id: dto.costCentreId, legalEntityId } }))) throw new BadRequestException('That cost centre is not in this company');
      out.costCentreId = dto.costCentreId;
    }
    if (dto.managerId !== undefined) {
      if (dto.managerId === '') out.managerId = null;
      else {
        if (dto.managerId === employmentId) throw new BadRequestException('Someone cannot be their own manager');
        const m = await this.prisma.employment.findFirst({ where: { id: dto.managerId, status: 'ACTIVE', legalEntity: { groupId: auth.groupId } }, select: { id: true, legalEntityId: true } });
        if (!m || !can(auth.access, 'people.read', m.legalEntityId)) throw new BadRequestException('Manager not found among active employees you can see');
        if (employmentId && (await this.access.wouldLoop(employmentId, m.id))) throw new BadRequestException('That manager already reports to this employee');
        out.managerId = m.id;
      }
    }
    return out;
  }

  private checkMoney(amount: string, currency: string) {
    const places = amount.split('.')[1]?.length ?? 0;
    if (places > currencyDecimals(currency)) throw new BadRequestException(`${currency} amounts take at most ${currencyDecimals(currency)} decimal places`);
  }

  // ───── Changes ─────

  async updatePersonal(auth: AuthContext, id: string, dto: UpdatePersonalDto) {
    const { subject, rel } = await this.access.resolve(auth, id);
    const hr = can(auth.access, 'people.manage', subject.legalEntityId);
    if (!hr && !rel.self) throw new ForbiddenException('You cannot change this record');
    // Validation leaves absent fields as undefined keys; only the ones sent count
    const fields = (Object.keys(dto) as (keyof UpdatePersonalDto)[]).filter((k) => dto[k] !== undefined);
    if (!hr && fields.some((f) => !(SELF_EDITABLE as readonly string[]).includes(f))) throw new ForbiddenException('Ask HR to change your name, gender, date of birth or nationality');
    const { dateOfBirth, ...rest } = dto;
    await this.prisma.person.update({ where: { id: subject.personId }, data: { ...rest, ...(dateOfBirth ? { dateOfBirth: date(dateOfBirth) } : {}) } });
    await this.audit.record(auth, { action: 'people.personal.updated', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { fields } });
    return this.get(auth, id);
  }

  async replaceContacts(auth: AuthContext, id: string, dto: ReplaceContactsDto) {
    const { subject, rel } = await this.access.resolve(auth, id);
    this.access.require(auth, subject, rel, 'people.manage', { allowSelf: true });
    await this.prisma.$transaction([
      this.prisma.personContact.deleteMany({ where: { personId: subject.personId } }),
      this.prisma.personContact.createMany({
        data: dto.contacts.map((c) => ({ personId: subject.personId, ...c, isEmergencyContact: c.isEmergencyContact ?? true, isBeneficiary: c.isBeneficiary ?? false })),
      }),
    ]);
    await this.audit.record(auth, { action: 'people.contacts.updated', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { count: dto.contacts.length } });
    return this.get(auth, id);
  }

  async updateEmployment(auth: AuthContext, id: string, dto: UpdateEmploymentDto) {
    const { subject, rel } = await this.access.resolve(auth, id);
    this.access.require(auth, subject, rel, 'people.manage');
    await this.prisma.employment.update({
      where: { id },
      data: { ...dto, workEmail: dto.workEmail?.toLowerCase(), probationEndDate: dto.probationEndDate ? date(dto.probationEndDate) : undefined },
    });
    await this.audit.record(auth, { action: 'people.employment.updated', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { fields: Object.keys(dto).filter((k) => dto[k as keyof UpdateEmploymentDto] !== undefined) } });
    return this.get(auth, id);
  }

  /** Closes the current job record at `effectiveFrom` (end dates are exclusive) and starts a new one */
  async addAssignment(auth: AuthContext, id: string, dto: NewAssignmentDto) {
    const { subject, rel } = await this.access.resolve(auth, id);
    this.access.require(auth, subject, rel, 'people.manage');
    if (subject.status !== 'ACTIVE') throw new BadRequestException('This person has left; their job history is closed');
    const from = date(dto.effectiveFrom);
    const org = await this.checkOrg(auth, subject.legalEntityId, dto, id);
    if (dto.fte !== undefined && !(Number(dto.fte) > 0 && Number(dto.fte) <= 1)) throw new BadRequestException('FTE must be more than 0 and at most 1');

    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.assignment.findFirst({ where: { employmentId: id }, orderBy: { effectiveFrom: 'desc' } });
      if (!latest) throw new BadRequestException('This employee has no job record to change');
      if (from <= latest.effectiveFrom) throw new BadRequestException(`The change must start after ${latest.effectiveFrom.toISOString().slice(0, 10)}, when the current record began`);
      await tx.assignment.update({ where: { id: latest.id }, data: { effectiveTo: from } });
      await tx.assignment.create({
        data: {
          employmentId: id,
          legalEntityId: subject.legalEntityId,
          effectiveFrom: from,
          reason: dto.reason,
          jobTitle: dto.jobTitle ?? latest.jobTitle,
          gradeId: org.gradeId !== undefined ? org.gradeId : latest.gradeId,
          businessUnitId: org.businessUnitId !== undefined ? org.businessUnitId : latest.businessUnitId,
          departmentId: org.departmentId !== undefined ? org.departmentId : latest.departmentId,
          branchId: org.branchId !== undefined ? org.branchId : latest.branchId,
          costCentreId: org.costCentreId !== undefined ? org.costCentreId : latest.costCentreId,
          managerId: org.managerId !== undefined ? org.managerId : latest.managerId,
          fte: dto.fte ?? latest.fte,
          createdById: auth.userId,
        },
      });
      await this.audit.record(auth, { action: 'people.job.changed', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { ...dto } }, tx);
    });
    return this.history(auth, id);
  }

  async addCompensation(auth: AuthContext, id: string, dto: NewCompensationDto) {
    const { subject, rel } = await this.access.resolve(auth, id);
    if (rel.self) throw new ForbiddenException('You cannot change your own pay');
    this.access.require(auth, subject, rel, 'people.manage');
    this.access.require(auth, subject, rel, 'people.sensitive.read', { message: 'You cannot change pay for this company' });
    if (subject.status !== 'ACTIVE') throw new BadRequestException('This person has left; pay cannot change');
    const entity = await this.prisma.legalEntity.findUniqueOrThrow({ where: { id: subject.legalEntityId }, select: { functionalCurrency: true } });
    this.checkMoney(dto.baseAmount, entity.functionalCurrency);
    if (dto.allowances) this.checkMoney(dto.allowances, entity.functionalCurrency);
    const from = date(dto.effectiveFrom);
    if (from < subject.hireDate) throw new BadRequestException('Pay cannot start before the hire date');

    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.compensation.findFirst({ where: { employmentId: id }, orderBy: { effectiveFrom: 'desc' } });
      if (latest && from <= latest.effectiveFrom) throw new BadRequestException(`The change must start after ${latest.effectiveFrom.toISOString().slice(0, 10)}, when the current pay began`);
      if (latest) await tx.compensation.update({ where: { id: latest.id }, data: { effectiveTo: from } });
      await tx.compensation.create({
        data: {
          employmentId: id,
          legalEntityId: subject.legalEntityId,
          effectiveFrom: from,
          currency: entity.functionalCurrency,
          baseAmount: dto.baseAmount,
          allowances: dto.allowances ?? latest?.allowances ?? '0',
          reason: dto.reason,
          createdById: auth.userId,
        },
      });
      await this.audit.record(
        auth,
        { action: 'people.pay.changed', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { effectiveFrom: dto.effectiveFrom, reason: dto.reason, previous: latest?.baseAmount.toString() ?? null, next: dto.baseAmount } },
        tx,
      );
    });
    return this.pay(auth, id);
  }

  async terminate(auth: AuthContext, id: string, dto: TerminateDto) {
    const { subject, rel } = await this.access.resolve(auth, id);
    if (rel.self) throw new ForbiddenException('You cannot end your own employment here');
    this.access.require(auth, subject, rel, 'people.manage');
    if (subject.status !== 'ACTIVE') throw new ConflictException('This person has already left');
    const end = date(dto.endDate);
    if (end < subject.hireDate) throw new BadRequestException('The leaving date cannot be before the hire date');
    const reports = await this.prisma.assignment.count({ where: { managerId: id, ...inForce(), employment: { status: 'ACTIVE' } } });
    await this.prisma.employment.update({ where: { id }, data: { endDate: end, exitReason: dto.exitReason, status: end <= today() ? 'TERMINATED' : 'ACTIVE' } });
    await this.audit.record(auth, { action: 'people.terminated', targetType: 'employment', targetId: id, legalEntityId: subject.legalEntityId, detail: { ...dto } });
    return { ...(await this.get(auth, id)), reportsNeedingManager: reports };
  }

  grades(auth: AuthContext) {
    return this.prisma.jobGrade.findMany({ where: { groupId: auth.groupId }, orderBy: { level: 'asc' }, select: { code: true, name: true, level: true } });
  }
}
