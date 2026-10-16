import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { can, Permission } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { PrismaService } from '../prisma/prisma.service';

/** Today as a UTC date, the granularity of effective dating */
export const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Filter for the assignment or pay row in force on a date */
export const inForce = (on = today()) => ({ effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }] });

/**
 * How the caller relates to one employment record:
 * - hr: holds people.read for its company (sees the whole record except revealed numbers)
 * - self: it is the caller's own record
 * - manager: the employee is somewhere below the caller in the reporting line (work details only)
 */
export interface Relation {
  hr: boolean;
  self: boolean;
  manager: boolean;
}

export interface Subject {
  id: string;
  legalEntityId: string;
  personId: string;
  userId: string | null;
  status: string;
  hireDate: Date;
  endDate: Date | null;
  employeeNumber: string;
}

const MAX_DEPTH = 8;

@Injectable()
export class PeopleAccess {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's own active employment ids */
  async ownEmploymentIds(auth: AuthContext) {
    const rows = await this.prisma.employment.findMany({ where: { userId: auth.userId }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Loads the employment and the caller's relation to it; Not found when there is none */
  async resolve(auth: AuthContext, employmentId: string): Promise<{ subject: Subject; rel: Relation }> {
    const subject = await this.prisma.employment.findFirst({
      where: { id: employmentId, legalEntity: { groupId: auth.groupId } },
      select: { id: true, legalEntityId: true, personId: true, userId: true, status: true, hireDate: true, endDate: true, employeeNumber: true },
    });
    if (!subject) throw new NotFoundException('Employee not found');
    const rel: Relation = {
      hr: can(auth.access, 'people.read', subject.legalEntityId),
      self: subject.userId === auth.userId,
      manager: false,
    };
    if (!rel.hr && !rel.self && can(auth.access, 'team.read')) rel.manager = await this.isAbove(auth, subject.id);
    if (!rel.hr && !rel.self && !rel.manager) throw new NotFoundException('Employee not found');
    return { subject, rel };
  }

  /** Throws unless the caller holds `permission` for the record's company (or, with allowSelf, it is their own) */
  require(auth: AuthContext, subject: Subject, rel: Relation, permission: Permission, opts: { allowSelf?: boolean; message?: string } = {}) {
    if (opts.allowSelf && rel.self) return;
    if (!can(auth.access, permission, subject.legalEntityId)) throw new ForbiddenException(opts.message ?? 'You cannot change this record');
  }

  /** Walks up the reporting line from the employee to see whether the caller is in it */
  private async isAbove(auth: AuthContext, employmentId: string) {
    const mine = new Set(await this.ownEmploymentIds(auth));
    if (!mine.size) return false;
    let current: string | null = employmentId;
    const seen = new Set<string>();
    for (let depth = 0; current && depth < MAX_DEPTH && !seen.has(current); depth++) {
      seen.add(current);
      const row: { managerId: string | null } | null = await this.prisma.assignment.findFirst({ where: { employmentId: current, ...inForce() }, select: { managerId: true } });
      current = row?.managerId ?? null;
      if (current && mine.has(current)) return true;
    }
    return false;
  }

  /** Everyone below the caller in the reporting line, with how many levels down they are */
  async team(auth: AuthContext) {
    const result = new Map<string, number>();
    let frontier = await this.ownEmploymentIds(auth);
    for (let depth = 1; frontier.length && depth <= MAX_DEPTH && result.size < 5000; depth++) {
      const rows = await this.prisma.assignment.findMany({
        where: { managerId: { in: frontier }, ...inForce(), employment: { status: 'ACTIVE' } },
        select: { employmentId: true },
      });
      frontier = rows.map((r) => r.employmentId).filter((id) => !result.has(id));
      frontier.forEach((id) => result.set(id, depth));
    }
    return result;
  }

  /** True when `managerId` reports (directly or not) to `employmentId`, which would make a loop */
  async wouldLoop(employmentId: string, managerId: string, tx: Prisma.TransactionClient = this.prisma) {
    let current: string | null = managerId;
    for (let depth = 0; current && depth < 50; depth++) {
      if (current === employmentId) return true;
      const row: { managerId: string | null } | null = await tx.assignment.findFirst({ where: { employmentId: current, ...inForce() }, select: { managerId: true } });
      current = row?.managerId ?? null;
    }
    return false;
  }
}
