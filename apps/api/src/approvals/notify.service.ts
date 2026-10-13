import { Injectable } from '@nestjs/common';
import { ApprovalStage, Role } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE_ROLE } from './stages';

/** Emails whoever must decide the next step, and the employee when a request is settled */
@Injectable()
export class ApprovalNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async stage(stage: ApprovalStage, approverId: string | null, subject: string, text: string) {
    let emails: string[] = [];
    if (stage === ApprovalStage.MANAGER) {
      const manager = approverId ? await this.prisma.employee.findUnique({ where: { id: approverId }, select: { user: { select: { email: true, isActive: true } } } }) : null;
      if (manager?.user?.isActive) emails = [manager.user.email];
    } else {
      const users = await this.prisma.user.findMany({ where: { role: STAGE_ROLE[stage]!, isActive: true }, select: { email: true } });
      emails = users.map((u) => u.email);
    }
    if (emails.length === 0) {
      const admins = await this.prisma.user.findMany({ where: { role: Role.ADMIN, isActive: true }, select: { email: true } });
      emails = admins.map((u) => u.email);
    }
    for (const to of emails) await this.mail.send({ to, subject, text: `${text}\nOpen Loan and benefit approvals in the HR portal to decide.` });
  }

  async employee(user: { email: string; isActive: boolean } | null | undefined, subject: string, text: string) {
    if (user?.isActive) await this.mail.send({ to: user.email, subject, text });
  }
}
