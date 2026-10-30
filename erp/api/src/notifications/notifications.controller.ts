import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { test } from './email-templates';
import { MailerService } from './mailer.service';
import { NotificationsService } from './notifications.service';
import { EmailAlertsDto, OutboxQuery } from './notifications.dto';

@Controller()
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Whether this person gets approval emails, and whether the server can send any */
  @Get('me/email-alerts')
  async alerts(@CurrentUser() user: AuthUser) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { emailAlerts: true } });
    return { emailAlerts: me.emailAlerts, configured: this.mailer.configured };
  }

  @Put('me/email-alerts')
  async setAlerts(@CurrentUser() user: AuthUser, @Body() dto: EmailAlertsDto) {
    await this.prisma.user.update({ where: { id: user.id }, data: { emailAlerts: dto.emailAlerts } });
    await this.audit.record({ userId: user.id, action: 'user.email_alerts', entity: 'User', entityId: user.id, label: user.email, detail: dto });
    return this.alerts(user);
  }

  /** The latest emails, newest first, for administrators checking that alerts go out */
  @Get('email/outbox')
  @Roles('ADMIN')
  async outbox(@Query() q: OutboxQuery) {
    const rows = await this.prisma.emailMessage.findMany({
      where: { status: q.status },
      orderBy: { id: 'desc' },
      take: 200,
      select: { id: true, kind: true, toEmail: true, subject: true, text: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true, voucher: { select: { voucherNo: true } } },
    });
    const counts = await this.prisma.emailMessage.groupBy({ by: ['status'], _count: true });
    return { configured: this.mailer.configured, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])), messages: rows };
  }

  /** Sends a test email to the administrator straight away */
  @Post('email/test')
  @Roles('ADMIN')
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const row = await this.prisma.$transaction(async (tx) => {
      await this.notifications.queue(tx, 'TEST', [me], test(me.name, this.notifications.link('/')));
      return tx.emailMessage.findFirstOrThrow({ where: { userId: me.id, kind: 'TEST' }, orderBy: { id: 'desc' } });
    });
    await this.mailer.flush();
    return this.prisma.emailMessage.findUniqueOrThrow({ where: { id: row.id }, select: { id: true, status: true, lastError: true, toEmail: true } });
  }

  /** Puts a failed or skipped email back in the queue, for example once SMTP is set up */
  @Post('email/outbox/:id/retry')
  @Roles('ADMIN')
  @HttpCode(200)
  async retry(@Param('id', ParseIntPipe) id: number) {
    const row = await this.prisma.emailMessage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`No email ${id}`);
    await this.prisma.emailMessage.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    await this.mailer.flush();
    return this.prisma.emailMessage.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, lastError: true } });
  }
}
