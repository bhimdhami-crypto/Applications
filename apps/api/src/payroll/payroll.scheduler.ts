import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PayrollService } from './payroll.service';

@Injectable()
export class PayrollScheduler {
  constructor(
    private readonly payroll: PayrollService,
    private readonly config: ConfigService,
  ) {}

  /** 06:00 UTC on the 20th of every month, leaving time to approve before payday on the 25th */
  @Cron('0 6 20 * *')
  async monthEnd() {
    if (this.config.get('PAYROLL_AUTODRAFT') !== 'true') return;
    await this.payroll.createMonthEndDrafts();
  }
}
