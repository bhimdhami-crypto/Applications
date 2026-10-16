import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DELEGABLE_ROLES, entitiesInScope, grantProblem, Role, ROLE_LABELS, RoleAssignmentLike } from '@gpp/shared';
import { AuthContext } from '../access/auth-context';
import { AuditService } from '../audit/audit.service';
import { hashToken, newToken } from '../identity/tokens';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, GrantDto, UpdateUserDto, UserListQuery } from './users.dto';

const INVITE_TTL_MS = 72 * 3600_000;

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
  lastLoginAt: true,
  lockedUntil: true,
  passwordHash: true,
  createdAt: true,
  roles: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Group-wide readers see everyone in the group. Others see users who hold at least one
   * role inside the companies they can read, and never group-wide accounts.
   */
  private visibilityFilter(auth: AuthContext, permission: 'users.read' | 'users.manage'): Prisma.UserWhereInput {
    const scope = auth.access.get(permission);
    if (!scope) return { id: { in: [] } };
    if (scope.group) return { groupId: auth.groupId };
    const ids = [...scope.entityIds];
    const fullCountries = [...new Set(auth.entities.map((e) => e.countryCode))].filter((c) => auth.entities.filter((e) => e.countryCode === c).every((e) => scope.entityIds.has(e.id)));
    return {
      groupId: auth.groupId,
      roles: { some: { OR: [{ scopeType: 'LEGAL_ENTITY', legalEntityId: { in: ids } }, { scopeType: 'COUNTRY', countryCode: { in: fullCountries } }] }, none: { scopeType: 'GROUP' } },
    };
  }

  private present(u: UserRow, names: Map<string, string>) {
    const { passwordHash, ...rest } = u;
    return {
      ...rest,
      invitePending: !passwordHash,
      locked: !!u.lockedUntil && u.lockedUntil > new Date(),
      roles: u.roles.map((r) => ({
        id: r.id,
        role: r.role,
        label: ROLE_LABELS[r.role as Role],
        scopeType: r.scopeType,
        countryCode: r.countryCode,
        legalEntityId: r.legalEntityId,
        scopeLabel: r.scopeType === 'GROUP' ? 'Whole group' : r.scopeType === 'COUNTRY' ? `Country: ${r.countryCode}` : (names.get(r.legalEntityId!) ?? 'Company'),
      })),
    };
  }

  private async entityNames(auth: AuthContext) {
    const rows = await this.prisma.legalEntity.findMany({ where: { groupId: auth.groupId }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async list(auth: AuthContext, q: UserListQuery) {
    const where: Prisma.UserWhereInput = {
      AND: [
        this.visibilityFilter(auth, 'users.read'),
        q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { displayName: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [total, rows, names] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { displayName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.entityNames(auth),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => this.present(r, names)) };
  }

  async get(auth: AuthContext, id: string, permission: 'users.read' | 'users.manage' = 'users.read') {
    const row = await this.prisma.user.findFirst({ where: { AND: [{ id }, this.visibilityFilter(auth, permission)] }, select: userSelect });
    if (!row) throw new NotFoundException('User not found');
    return row;
  }

  async getPresented(auth: AuthContext, id: string) {
    return this.present(await this.get(auth, id), await this.entityNames(auth));
  }

  private problem(auth: AuthContext, targetId: string, existing: RoleAssignmentLike[], grant: GrantDto) {
    const clean: RoleAssignmentLike = {
      role: grant.role,
      scopeType: grant.scopeType,
      countryCode: grant.scopeType === 'COUNTRY' ? grant.countryCode : null,
      legalEntityId: grant.scopeType === 'LEGAL_ENTITY' ? grant.legalEntityId : null,
    };
    if (grant.scopeType === 'COUNTRY' && !grant.countryCode) return { clean, problem: 'Choose the country' };
    if (grant.scopeType === 'LEGAL_ENTITY' && !grant.legalEntityId) return { clean, problem: 'Choose the company' };
    return { clean, problem: grantProblem({ access: auth.access, roles: auth.roles, userId: auth.userId }, { userId: targetId, existing }, clean, auth.entities) };
  }

  async create(auth: AuthContext, dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new BadRequestException('A user with that email already exists');
    const grants: RoleAssignmentLike[] = [];
    for (const g of dto.roles) {
      const { clean, problem } = this.problem(auth, '(new)', grants, g);
      if (problem) throw new ForbiddenException(problem);
      grants.push(clean);
    }
    const token = newToken();
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { groupId: auth.groupId, email, displayName: dto.displayName.trim() } });
      for (const g of grants) {
        await tx.roleAssignment.create({ data: { userId: u.id, role: g.role, scopeType: g.scopeType, countryCode: g.countryCode, legalEntityId: g.legalEntityId, grantedById: auth.userId } });
      }
      await tx.userInvite.create({ data: { userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
      await this.audit.record(auth, { action: 'users.created', targetType: 'user', targetId: u.id, detail: { email, roles: grants as unknown as Prisma.InputJsonValue } }, tx);
      return u;
    });
    await this.sendInvite(email, dto.displayName, token);
    return this.getPresented(auth, user.id);
  }

  private async sendInvite(email: string, name: string, token: string) {
    const origin = this.config.get('WEB_ORIGIN', 'http://localhost:3000');
    await this.mail.send({
      to: email,
      subject: 'You have been invited to the Mindspace Portal',
      text: `Hello ${name},\n\nAn administrator has given you access to the Mindspace Portal. Set your password here within 72 hours:\n\n${origin}/accept-invite?token=${token}\n\nIf you were not expecting this, ignore this email.`,
    });
  }

  async resendInvite(auth: AuthContext, id: string) {
    const u = await this.get(auth, id, 'users.manage');
    if (u.passwordHash) throw new BadRequestException('This user has already set a password');
    const token = newToken();
    await this.prisma.userInvite.create({ data: { userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
    await this.audit.record(auth, { action: 'users.invite_resent', targetType: 'user', targetId: u.id });
    await this.sendInvite(u.email, u.displayName, token);
  }

  async grant(auth: AuthContext, id: string, dto: GrantDto) {
    const u = await this.get(auth, id, 'users.manage');
    const existing = u.roles.map((r) => ({ role: r.role as Role, scopeType: r.scopeType, countryCode: r.countryCode, legalEntityId: r.legalEntityId }));
    const { clean, problem } = this.problem(auth, u.id, existing, dto);
    if (problem) throw new ForbiddenException(problem);
    if (existing.some((r) => r.role === clean.role && r.scopeType === clean.scopeType && r.countryCode === clean.countryCode && r.legalEntityId === clean.legalEntityId)) {
      throw new BadRequestException('The user already has that role');
    }
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.roleAssignment.create({ data: { userId: u.id, role: clean.role, scopeType: clean.scopeType, countryCode: clean.countryCode, legalEntityId: clean.legalEntityId, grantedById: auth.userId } });
      await this.audit.record(auth, { action: 'users.role_granted', targetType: 'user', targetId: u.id, legalEntityId: clean.legalEntityId, detail: { assignmentId: row.id, ...clean } as Prisma.InputJsonValue }, tx);
    });
    return this.getPresented(auth, u.id);
  }

  async revoke(auth: AuthContext, id: string, assignmentId: string) {
    if (id === auth.userId) throw new ForbiddenException('You cannot change your own roles');
    const u = await this.get(auth, id, 'users.manage');
    const a = u.roles.find((r) => r.id === assignmentId);
    if (!a) throw new NotFoundException('Role not found');
    this.assertCovers(auth, [a as RoleAssignmentLike], true);
    await this.prisma.$transaction(async (tx) => {
      await tx.roleAssignment.delete({ where: { id: a.id } });
      await this.audit.record(auth, { action: 'users.role_revoked', targetType: 'user', targetId: u.id, legalEntityId: a.legalEntityId, detail: { role: a.role, scopeType: a.scopeType, countryCode: a.countryCode, legalEntityId: a.legalEntityId } }, tx);
    });
    return this.getPresented(auth, u.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateUserDto) {
    if (id === auth.userId && dto.isActive === false) throw new ForbiddenException('You cannot deactivate your own account');
    const u = await this.get(auth, id, 'users.manage');
    // Only someone who covers every role the user holds may change the account itself
    this.assertCovers(auth, u.roles as RoleAssignmentLike[], false);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: dto });
      if (dto.isActive === false) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'account deactivated' } });
      await this.audit.record(auth, { action: dto.isActive === false ? 'users.deactivated' : dto.isActive ? 'users.reactivated' : 'users.updated', targetType: 'user', targetId: id, detail: { ...dto } }, tx);
    });
    return this.getPresented(auth, id);
  }

  async unlock(auth: AuthContext, id: string) {
    const u = await this.get(auth, id, 'users.manage');
    this.assertCovers(auth, u.roles as RoleAssignmentLike[], false);
    await this.prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await this.audit.record(auth, { action: 'users.unlocked', targetType: 'user', targetId: id });
  }

  private assertCovers(auth: AuthContext, roles: RoleAssignmentLike[], checkDelegable: boolean) {
    const manage = auth.access.get('users.manage');
    if (!manage) throw new ForbiddenException('You cannot manage users');
    if (manage.group && auth.roles.some((r) => r.role === 'GROUP_ADMIN' && r.scopeType === 'GROUP')) return;
    for (const r of roles) {
      if (checkDelegable && !DELEGABLE_ROLES.includes(r.role)) throw new ForbiddenException(`Only a group administrator can remove the ${ROLE_LABELS[r.role]} role`);
      if (r.scopeType === 'GROUP' && !manage.group) throw new ForbiddenException('That user has group-wide roles');
      if (!manage.group && entitiesInScope(r, auth.entities).some((e) => !manage.entityIds.has(e))) throw new ForbiddenException('That user has roles outside the companies you manage');
    }
  }
}
