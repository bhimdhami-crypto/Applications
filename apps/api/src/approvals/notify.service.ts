import { Injectable } from '@nestjs/common';
import { ApprovalStage, Role } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS } from '@gpp/shared';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE_PERMISSION } from './stages';

const rolesWith = (p: Permission) => (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => ROLE_PERMISSIONS[r].includes(p));

/** Emails whoever must decide the next step, and the employee when a request is settled */
@Injectable()
export class ApprovalNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * People holding a permission for a company: company or country scoped first, group-wide
   * holders only when there is nobody closer. Never the employee the request is about.
   */
  async holders(permission: Permission, entity: { id: string; countryCode: string; groupId: string }, exceptUserId?: string | null) {
    const rows = await this.prisma.roleAssignment.findMany({
      where: { role: { in: rolesWith(permission) }, user: { groupId: entity.groupId, isActive: true } },
      select: { scopeType: true, countryCode: true, legalEntityId: true, user: { select: { id: true, email: true } } },
    });
    const others = rows.filter((r) => r.user.id !== exceptUserId);
    const close = others.filter((r) => (r.scopeType === 'LEGAL_ENTITY' && r.legalEntityId === entity.id) || (r.scopeType === 'COUNTRY' && r.countryCode === entity.countryCode));
    const pick = close.length ? close : others.filter((r) => r.scopeType === 'GROUP');
    return [...new Set(pick.map((r) => r.user.email))];
  }

  async stage(stage: ApprovalStage, approverId: string | null, entity: { id: string; countryCode: string; groupId: string }, employeeUserId: string | null, subject: string, text: string) {
    let emails: string[] = [];
    if (stage === ApprovalStage.MANAGER) {
      const manager = approverId ? await this.prisma.employment.findUnique({ where: { id: approverId }, select: { user: { select: { email: true, isActive: true } } } }) : null;
      if (manager?.user?.isActive) emails = [manager.user.email];
    } else {
      emails = await this.holders(STAGE_PERMISSION[stage]!, entity, employeeUserId);
    }
    for (const to of emails) await this.mail.send({ to, subject, text: `${text}\nOpen Approvals in the portal to decide.` });
  }

  async employee(user: { email: string; isActive: boolean } | null | undefined, subject: string, text: string) {
    if (user?.isActive) await this.mail.send({ to: user.email, subject, text });
  }
}
