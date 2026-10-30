import { Controller, Get, Param, Query } from '@nestjs/common';
import { AgedQuery, GeneralLedgerQuery, StatementQuery } from './reports.dto';
import { ReportsService } from './reports.service';

@Controller('companies/:company/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('general-ledger')
  generalLedger(@Param('company') company: string, @Query() q: GeneralLedgerQuery) {
    return this.reports.generalLedger(company, q.from, q.to, q.account);
  }

  @Get('aged')
  aged(@Param('company') company: string, @Query() q: AgedQuery) {
    return this.reports.aged(company, q.kind, q.asAt);
  }

  @Get('statement')
  statement(@Param('company') company: string, @Query() q: StatementQuery) {
    return this.reports.statement(company, q.party, q.from, q.to);
  }
}
