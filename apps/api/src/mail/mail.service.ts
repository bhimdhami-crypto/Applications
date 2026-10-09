import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email over SMTP (Mailpit in development) or keeps it in memory for tests.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: 'smtp' | 'memory';
  private readonly smtp?: nodemailer.Transporter;
  readonly outbox: SentMail[] = [];

  constructor(private readonly config: ConfigService) {
    this.transport = config.get('MAIL_TRANSPORT') === 'memory' ? 'memory' : 'smtp';
    if (this.transport === 'smtp') {
      this.smtp = nodemailer.createTransport({
        host: config.get('SMTP_HOST', 'localhost'),
        port: Number(config.get('SMTP_PORT', 1025)),
        secure: config.get('SMTP_SECURE') === 'true',
        auth: config.get('SMTP_USER') ? { user: config.get('SMTP_USER'), pass: config.get('SMTP_PASS') } : undefined,
      });
    }
  }

  async send(mail: SentMail) {
    if (this.transport === 'memory') {
      this.outbox.push(mail);
      return;
    }
    await this.smtp!.sendMail({ from: this.config.get('MAIL_FROM', 'Mindspace HR <no-reply@mindspace-ai.test>'), ...mail });
    this.logger.log(`Sent "${mail.subject}" to ${mail.to}`);
  }
}
