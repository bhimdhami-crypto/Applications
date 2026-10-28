import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCycleDto, CreateGoalDto, SubmitReviewDto, UpdateGoalDto } from './performance.dto';

const PERSON = { id: true, employeeNo: true, firstName: true, lastName: true, jobTitle: true, department: true, photoKey: true } satisfies Prisma.EmployeeSelect;
type Person = Prisma.EmployeeGetPayload<{ select: typeof PERSON }>;
const person = (p: Person | null) => (p ? (({ photoKey, ...rest }) => ({ ...rest, hasPhoto: !!photoKey }))(p) : null);

const REVIEW_INCLUDE = {
  cycle: { select: { id: true, name: true, status: true, selfDueOn: true, managerDueOn: true, periodStart: true, periodEnd: true } },
  employee: { select: PERSON },
  reviewer: { select: PERSON },
} satisfies Prisma.PerformanceReviewInclude;
type ReviewRow = Prisma.PerformanceReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;
const review = (r: ReviewRow) => ({ ...r, employee: person(r.employee), reviewer: person(r.reviewer) });

export const RATING_LABEL: Record<number, string> = {
  1: 'Below expectations',
  2: 'Partly meets expectations',
  3: 'Meets expectations',
  4: 'Exceeds expectations',
  5: 'Exceptional',
};

/**
 * Review cycles (self review, then the manager's review), and goals.
 * Nobody completes their own manager review; HR completes reviews for people without a manager.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ---------- Cycles ----------

  async cycles(actor: AuthUser, companyId?: string) {
    const where: Prisma.ReviewCycleWhereInput = {};
    if (this.isHr(actor)) {
      if (companyId) where.companyId = companyId;
    } else {
      const me = await this.me(actor);
      where.companyId = me.companyId;
    }
    const cycles = await this.prisma.reviewCycle.findMany({
      where,
      orderBy: [{ status: 'asc' }, { periodEnd: 'desc' }],
      include: { company: { select: { name: true, countryCode: true } } },
    });
    const counts = await this.prisma.performanceReview.groupBy({
      by: ['cycleId', 'status'],
      where: { cycleId: { in: cycles.map((c) => c.id) } },
      _count: { _all: true },
    });
    const ratings = await this.prisma.performanceReview.groupBy({
      by: ['cycleId', 'managerRating'],
      where: { cycleId: { in: cycles.map((c) => c.id) }, status: 'COMPLETED' },
      _count: { _all: true },
    });
    return cycles.map((c) => {
      const n = (s: string) => counts.find((x) => x.cycleId === c.id && x.status === s)?._count._all ?? 0;
      const total = n('SELF_REVIEW') + n('MANAGER_REVIEW') + n('COMPLETED');
      return {
        ...c,
        progress: { total, selfReview: n('SELF_REVIEW'), managerReview: n('MANAGER_REVIEW'), completed: n('COMPLETED') },
        ratings: [1, 2, 3, 4, 5].map((r) => ({ rating: r, label: RATING_LABEL[r], count: ratings.find((x) => x.cycleId === c.id && x.managerRating === r)?._count._all ?? 0 })),
      };
    });
  }

  /** Opens a cycle for everyone in the company who has a portal login, and emails them. HR only. */
  async createCycle(actor: AuthUser, dto: CreateCycleDto) {
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId } });
    if (!company) throw new BadRequestException('Unknown company');
    const [start, end, selfDue, managerDue] = [dto.periodStart, dto.periodEnd, dto.selfDueOn, dto.managerDueOn].map((d) => new Date(d));
    if (end <= start) throw new BadRequestException('The review period must end after it starts');
    if (managerDue < selfDue) throw new BadRequestException('Manager reviews must be due on or after self reviews');
    if (await this.prisma.reviewCycle.findFirst({ where: { companyId: company.id, status: 'OPEN' } })) {
      throw new BadRequestException('This company already has an open review cycle. Close it first.');
    }
    const people = await this.prisma.employee.findMany({
      where: { companyId: company.id, status: 'ACTIVE', deletedAt: null, userId: { not: null } },
      select: { id: true, managerId: true, firstName: true, user: { select: { email: true } } },
    });
    const cycle = await this.prisma.reviewCycle.create({
      data: {
        name: dto.name,
        companyId: company.id,
        periodStart: start,
        periodEnd: end,
        selfDueOn: selfDue,
        managerDueOn: managerDue,
        createdById: actor.id,
        reviews: { create: people.map((p) => ({ employeeId: p.id, reviewerId: p.managerId })) },
      },
    });
    const due = selfDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    for (const p of people) {
      if (!p.user) continue;
      await this.mail.send({
        to: p.user.email,
        subject: `${dto.name}: your self review is open`,
        text: `Hello ${p.firstName},\n\n${dto.name} has started. Please complete your self review under Performance in the HR portal by ${due}.\n\nYour manager reviews it next.`,
      });
    }
    await this.audit.record(actor.id, 'performance.cycle_open', 'ReviewCycle', cycle.id, { name: dto.name, reviews: people.length });
    return { ...cycle, reviews: people.length };
  }

  async closeCycle(actor: AuthUser, id: string) {
    const cycle = await this.prisma.reviewCycle.findUnique({ where: { id } });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status === 'CLOSED') throw new BadRequestException('This cycle is already closed');
    const updated = await this.prisma.reviewCycle.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await this.audit.record(actor.id, 'performance.cycle_close', 'ReviewCycle', id);
    return updated;
  }

  /** Every review in a cycle (HR) or the ones the manager gives. */
  async cycleReviews(actor: AuthUser, cycleId: string) {
    const where: Prisma.PerformanceReviewWhereInput = { cycleId };
    if (!this.isHr(actor)) where.reviewerId = (await this.me(actor)).id;
    const rows = await this.prisma.performanceReview.findMany({
      where,
      include: REVIEW_INCLUDE,
      orderBy: [{ status: 'asc' }, { employee: { lastName: 'asc' } }],
    });
    return rows.map(review);
  }

  // ---------- Reviews ----------

  /** My own reviews, and the reviews waiting for me as a manager. */
  async mine(actor: AuthUser) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!me) return { own: [], toGive: [] };
    const [own, toGive] = await Promise.all([
      this.prisma.performanceReview.findMany({ where: { employeeId: me.id }, include: REVIEW_INCLUDE, orderBy: { createdAt: 'desc' } }),
      this.prisma.performanceReview.findMany({
        where: { reviewerId: me.id, cycle: { status: 'OPEN' } },
        include: REVIEW_INCLUDE,
        orderBy: [{ status: 'asc' }, { employee: { lastName: 'asc' } }],
      }),
    ]);
    return { own: own.map(review), toGive: toGive.map(review) };
  }

  async submitSelf(actor: AuthUser, id: string, dto: SubmitReviewDto) {
    const r = await this.prisma.performanceReview.findUnique({ where: { id }, include: REVIEW_INCLUDE });
    if (!r) throw new NotFoundException('Review not found');
    const me = await this.me(actor);
    if (r.employeeId !== me.id) throw new ForbiddenException('This is not your review');
    if (r.cycle.status !== 'OPEN') throw new BadRequestException('This review cycle is closed');
    if (r.status !== 'SELF_REVIEW') throw new BadRequestException('Your self review has already been sent');
    const updated = await this.prisma.performanceReview.update({
      where: { id },
      data: { selfRating: dto.rating, selfComments: dto.comments, selfSubmittedAt: new Date(), status: 'MANAGER_REVIEW' },
      include: REVIEW_INCLUDE,
    });
    const reviewer = r.reviewerId ? await this.prisma.employee.findUnique({ where: { id: r.reviewerId }, select: { firstName: true, user: { select: { email: true } } } }) : null;
    if (reviewer?.user) {
      await this.mail.send({
        to: reviewer.user.email,
        subject: `${r.employee.firstName} ${r.employee.lastName} sent their self review`,
        text: `Hello ${reviewer.firstName},\n\n${r.employee.firstName} ${r.employee.lastName} has completed their self review for ${r.cycle.name}. Please add your review under Performance in the HR portal.`,
      });
    }
    await this.audit.record(actor.id, 'performance.self_review', 'PerformanceReview', id, { rating: dto.rating });
    return review(updated);
  }

  async submitManager(actor: AuthUser, id: string, dto: SubmitReviewDto) {
    const r = await this.prisma.performanceReview.findUnique({ where: { id }, include: REVIEW_INCLUDE });
    if (!r) throw new NotFoundException('Review not found');
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (me?.id === r.employeeId) throw new ForbiddenException('You cannot complete your own manager review');
    const isReviewer = !!me && me.id === r.reviewerId;
    // HR steps in for people whose manager has no login or who have no manager
    if (!isReviewer && !this.isHr(actor)) throw new ForbiddenException('Only their manager or HR can complete this review');
    if (r.cycle.status !== 'OPEN') throw new BadRequestException('This review cycle is closed');
    if (r.status === 'COMPLETED') throw new BadRequestException('This review is already complete');
    if (r.status === 'SELF_REVIEW') throw new BadRequestException('Wait for the self review first');
    const updated = await this.prisma.performanceReview.update({
      where: { id },
      data: { managerRating: dto.rating, managerComments: dto.comments, completedAt: new Date(), status: 'COMPLETED' },
      include: REVIEW_INCLUDE,
    });
    const employee = await this.prisma.employee.findUnique({ where: { id: r.employeeId }, select: { user: { select: { email: true } } } });
    if (employee?.user) {
      await this.mail.send({
        to: employee.user.email,
        subject: `Your ${r.cycle.name} review is complete`,
        text: `Hello ${r.employee.firstName},\n\nYour review for ${r.cycle.name} is complete. Your overall rating is ${dto.rating} of 5 (${RATING_LABEL[dto.rating]}). You can read the comments under Performance in the HR portal.`,
      });
    }
    await this.audit.record(actor.id, 'performance.manager_review', 'PerformanceReview', id, { rating: dto.rating });
    return review(updated);
  }

  // ---------- Goals ----------

  async goals(actor: AuthUser, employeeId?: string) {
    const target = await this.goalTarget(actor, employeeId);
    const goals = await this.prisma.goal.findMany({
      where: { employeeId: target.id },
      orderBy: [{ status: 'asc' }, { dueOn: 'asc' }, { createdAt: 'asc' }],
      include: { cycle: { select: { name: true } } },
    });
    const active = goals.filter((g) => g.status !== 'CANCELLED');
    const weight = active.reduce((s, g) => s + g.weight, 0);
    const score = weight ? Math.round(active.reduce((s, g) => s + g.weight * g.progress, 0) / weight) : Math.round(active.reduce((s, g) => s + g.progress, 0) / (active.length || 1));
    return { employee: person(target), goals, summary: { count: active.length, weight, progress: score } };
  }

  async createGoal(actor: AuthUser, dto: CreateGoalDto) {
    const target = await this.goalTarget(actor, dto.employeeId);
    if (dto.cycleId && !(await this.prisma.reviewCycle.findUnique({ where: { id: dto.cycleId } }))) throw new BadRequestException('Unknown review cycle');
    const goal = await this.prisma.goal.create({
      data: {
        employeeId: target.id,
        cycleId: dto.cycleId,
        title: dto.title,
        description: dto.description,
        weight: dto.weight ?? 0,
        dueOn: dto.dueOn ? new Date(dto.dueOn) : undefined,
        createdById: actor.id,
      },
    });
    await this.audit.record(actor.id, 'performance.goal_create', 'Goal', goal.id, { employeeId: target.id });
    return goal;
  }

  async updateGoal(actor: AuthUser, id: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal) throw new NotFoundException('Goal not found');
    await this.goalTarget(actor, goal.employeeId);
    const { dueOn, ...rest } = dto;
    const data: Prisma.GoalUpdateInput = { ...rest, ...(dueOn ? { dueOn: new Date(dueOn) } : {}) };
    if (dto.progress === 100 && !dto.status) data.status = 'COMPLETED';
    const updated = await this.prisma.goal.update({ where: { id }, data });
    await this.audit.record(actor.id, 'performance.goal_update', 'Goal', id, { ...dto } as Prisma.InputJsonValue);
    return updated;
  }

  async deleteGoal(actor: AuthUser, id: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal) throw new NotFoundException('Goal not found');
    await this.goalTarget(actor, goal.employeeId);
    await this.prisma.goal.delete({ where: { id } });
    await this.audit.record(actor.id, 'performance.goal_delete', 'Goal', id, { employeeId: goal.employeeId, title: goal.title });
    return { deleted: true };
  }

  /** Whose goals: your own, a direct report's (managers) or anyone's (HR). */
  private async goalTarget(actor: AuthUser, employeeId?: string) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { ...PERSON, managerId: true } });
    if (!employeeId || employeeId === me?.id) {
      if (!me) throw new BadRequestException('Choose an employee');
      return me;
    }
    const target = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { ...PERSON, managerId: true } });
    if (!target) throw new NotFoundException('Employee not found');
    if (this.isHr(actor)) return target;
    if (me && target.managerId === me.id) return target;
    throw new ForbiddenException('You can only see goals for yourself and your direct reports');
  }

  private async me(actor: AuthUser) {
    const me = await this.prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true, companyId: true } });
    if (!me) throw new ForbiddenException('No employee record');
    return me;
  }

  private isHr(actor: AuthUser) {
    return actor.role === Role.HR || actor.role === Role.ADMIN;
  }
}
