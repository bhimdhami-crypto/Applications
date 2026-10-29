import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateAccountDto, DateRangeQuery, PostJournalDto, ReverseJournalDto } from './ledger.dto';
import { LedgerService } from './ledger.service';

@Controller('companies/:company')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  accounts(@Param('company') company: string) {
    return this.ledger.accounts(company);
  }

  @Post('accounts')
  @Roles('ACCOUNTANT')
  createAccount(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.ledger.createAccount(company, user, dto);
  }

  @Get('journals')
  journals(@Param('company') company: string, @Query() q: DateRangeQuery) {
    return this.ledger.journals(company, q.from, q.to);
  }

  @Get('journals/:auditNo')
  journal(@Param('company') company: string, @Param('auditNo') auditNo: string) {
    return this.ledger.journal(company, auditNo);
  }

  @Post('journals')
  @Roles('ACCOUNTANT')
  post(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: PostJournalDto) {
    return this.ledger.postJournal(company, user, dto);
  }

  @Post('journals/:auditNo/reverse')
  @Roles('ACCOUNTANT')
  reverse(
    @Param('company') company: string,
    @Param('auditNo') auditNo: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReverseJournalDto,
  ) {
    return this.ledger.reverseJournal(company, user, auditNo, dto.txDate);
  }

  @Get('trial-balance')
  trialBalance(@Param('company') company: string, @Query() q: DateRangeQuery) {
    return this.ledger.trialBalance(company, q.from, q.to);
  }
}
