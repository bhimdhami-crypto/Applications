import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateAccountDto, DateRangeQuery, UpdateAccountDto } from './ledger.dto';
import { LedgerService } from './ledger.service';

@Controller('companies/:company')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  accounts(@Param('company') company: string) {
    return this.ledger.accounts(company);
  }

  @Post('accounts')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  createAccount(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.ledger.createAccount(company, user, dto);
  }

  @Patch('accounts/:id')
  @Roles('FINANCE_MANAGER')
  updateAccount(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.ledger.updateAccount(company, id, user, dto);
  }

  @Get('journals')
  journals(@Param('company') company: string, @Query() q: DateRangeQuery) {
    return this.ledger.journals(company, q.from, q.to);
  }

  @Get('journals/:auditNo')
  journal(@Param('company') company: string, @Param('auditNo') auditNo: string) {
    return this.ledger.journal(company, auditNo);
  }

  @Get('trial-balance')
  trialBalance(@Param('company') company: string, @Query() q: DateRangeQuery) {
    return this.ledger.trialBalance(company, q.from, q.to);
  }
}
