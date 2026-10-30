import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { WaitingItem, digest } from './email-templates';
import { NotificationsService, activePeople } from './notifications.service';
import { stageRecipients } from './recipients';

const BATCH = 20;
const MAX_ATTEMPTS = 5;
/** Minutes to wait before each retry: a mail server that is briefly down is tried again over two hours */
const BACKOFF_MINUTES = [1, 5, 15, 60];
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar date and hour in Nairobi (UTC+3 all year) */
export function nairobiClock(now: Date) {
  const local = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  const midnight = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - NAIROBI_OFFSET_MS);
  return { hour: local.getUTCHours(), weekday: local.getUTCDay(), midnight };
}

/**
 * Sends queued email over SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM), retrying with
 * back-off, and on weekday mornings queues each approver's reminder of vouchers that have waited a day
 * or more. Without SMTP_HOST nothing is sent: messages are kept as SKIPPED so administrators can see them.
 */
@Injectable()
export class MailerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Mailer');
  private readonly transport: Transporter | null;
  private readonly from: string;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {
    const host = config.get<string>('SMTP_HOST');
    const port = Number(config.get('SMTP_PORT', 587));
    this.from = config.get('SMTP_FROM', 'MFI ERP <erp@localhost>');
    if (config.get('EMAIL_TRANSPORT') === 'json') {
      // For tests and dry runs: builds each message completely but sends nothing
      this.transport = createTransport({ jsonTransport: true });
    } else if (host) {
      const user = config.get<string>('SMTP_USER');
      this.transport = createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
        // Office 365 and most company servers take STARTTLS on 587; refuse to send credentials in clear
        requireTLS: port !== 465 && config.get('SMTP_REQUIRE_TLS', 'true') !== 'false',
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } else {
      this.transport = null;
    }
  }

  get configured() {
    return !!this.transport;
  }

  onModuleInit() {
    if (this.config.get('EMAIL_WORKER') === 'off') return;
    if (!this.transport) this.log.warn('SMTP_HOST is not set: approval emails are recorded but not sent');
    this.timer = setInterval(() => void this.tick(), Number(this.config.get('EMAIL_POLL_MS', 30_000)));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass of the worker; never overlaps itself */
  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.queueDigests(now);
      await this.flush(now);
    } catch (e) {
      this.log.error(`Email worker: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Sends what is due; returns how many were sent */
  async flush(now = new Date()) {
    const due = await this.prisma.emailMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    let sent = 0;
    for (const m of due) {
      if (!this.transport) {
        await this.prisma.emailMessage.update({ where: { id: m.id }, data: { status: 'SKIPPED', lastError: 'Email is not set up: SMTP_HOST is empty' } });
        continue;
      }
      try {
        await this.transport.sendMail({ from: this.from, to: m.toEmail, subject: m.subject, text: m.text, html: m.html });
        await this.prisma.emailMessage.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date(), attempts: m.attempts + 1, lastError: null } });
        sent++;
      } catch (e) {
        const attempts = m.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
        await this.prisma.emailMessage.update({
          where: { id: m.id },
          data: {
            attempts,
            status: giveUp ? 'FAILED' : 'PENDING',
            nextAttemptAt: new Date(now.getTime() + wait * 60_000),
            lastError: String((e as Error).message).slice(0, 1000),
          },
        });
        this.log.warn(`Email ${m.id} to ${m.toEmail} failed (attempt ${attempts}): ${(e as Error).message}`);
      }
    }
    return sent;
  }

  /**
   * Weekday mornings from 08:00 to noon in Nairobi, once a day per person: a reminder of every voucher
   * that has waited on them for a day or more. Who is reminded follows the same rule as the first email.
   */
  async queueDigests(now = new Date()) {
    const { hour, weekday, midnight } = nairobiClock(now);
    if (weekday === 0 || weekday === 6 || hour < 8 || hour >= 12) return 0;
    const waiting = await this.prisma.voucher.findMany({
      where: { status: 'SUBMITTED' },
      include: { company: { select: { code: true, homeCurrency: true } }, rule: { include: { stages: true } }, actions: { orderBy: { id: 'asc' } } },
    });
    const people = await activePeople(this.prisma);
    const byPerson = new Map<number, WaitingItem[]>();
    for (const v of waiting) {
      const stage = v.rule?.stages.find((s) => s.stageNo === v.currentStage);
      // The stage started at the last approval or submission
      const since = v.actions.at(-1)?.at ?? v.submittedAt;
      if (!stage || !since || now.getTime() - since.getTime() < DAY_MS) continue;
      const { recipients } = stageRecipients(stage, v, v.actions, people);
      for (const p of recipients) {
        const items = byPerson.get(p.id) ?? [];
        items.push({
          companyCode: v.company.code,
          voucherNo: v.voucherNo,
          description: v.description,
          amount: v.totalAmount?.toString() ?? '0',
          currency: v.company.homeCurrency,
          stage: stage.name,
          days: Math.floor((now.getTime() - since.getTime()) / DAY_MS),
        });
        byPerson.set(p.id, items);
      }
    }
    if (!byPerson.size) return 0;
    const already = await this.prisma.emailMessage.findMany({
      where: { kind: 'DIGEST', createdAt: { gte: midnight }, userId: { in: [...byPerson.keys()] } },
      select: { userId: true },
    });
    const done = new Set(already.map((d) => d.userId));
    let queued = 0;
    for (const [id, items] of byPerson) {
      if (done.has(id)) continue;
      const p = people.find((x) => x.id === id)!;
      // Dated by the worker's clock, which is what the once-a-day check compares against
      await this.notifications.queue(this.prisma, 'DIGEST', [p], digest(p.name, items, this.notifications.link('/approvals')), undefined, now);
      queued++;
    }
    return queued;
  }
}
