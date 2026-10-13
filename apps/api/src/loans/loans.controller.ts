import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { UploadedFileLike } from '../profiles/profiles.service';
import { CashRepaymentDto, CreateLoanDto, LoanBookQuery, LoanListQuery, LoanQuoteQuery, SettleIouDto } from './loans.dto';
import { LoansService } from './loans.service';

const MAX_UPLOAD = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };

/** Salary advances, staff loans and IOUs */
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get('options')
  options(@CurrentUser() user: AuthUser) {
    return this.loans.options(user);
  }

  @Get('quote')
  quote(@CurrentUser() user: AuthUser, @Query() q: LoanQuoteQuery) {
    return this.loans.quote(user, q);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: LoanListQuery) {
    return this.loans.list(user, q.employeeId);
  }

  @Get('book')
  @Roles(Role.PAYROLL, Role.FINANCE)
  book(@Query() q: LoanBookQuery) {
    return this.loans.book(q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLoanDto) {
    return this.loans.create(user, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loans.cancel(user, id);
  }

  @Post(':id/settle')
  @UseInterceptors(FileInterceptor('file', MAX_UPLOAD))
  settle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SettleIouDto, @UploadedFile() file?: UploadedFileLike) {
    return this.loans.submitSettlement(user, id, dto, file);
  }

  @Get(':id/receipt')
  async receipt(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { data, mime, fileName } = await this.loans.receipt(user, id);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Post(':id/recover')
  @Roles(Role.FINANCE)
  recover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loans.recoverUnsettled(user, id);
  }

  @Post(':id/repayments')
  @Roles(Role.FINANCE)
  repay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CashRepaymentDto) {
    return this.loans.recordCash(user, id, dto);
  }
}
