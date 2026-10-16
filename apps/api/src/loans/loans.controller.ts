import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { MAX_UPLOAD_BYTES, UploadedFileLike } from '../people/documents.service';
import { CashRepaymentDto, CreateLoanDto, LoanBookQuery, LoanListQuery, LoanQuoteQuery, SettleIouDto } from './loans.dto';
import { LoansService } from './loans.service';

const UPLOAD = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };

/** Salary advances, staff loans and IOUs */
@ApiTags('loans')
@ApiBearerAuth()
@Controller('loans')
@RequirePermission('self.service')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get('options')
  options(@Auth() auth: AuthContext) {
    return this.loans.options(auth);
  }

  @Get('quote')
  quote(@Auth() auth: AuthContext, @Query() q: LoanQuoteQuery) {
    return this.loans.quote(auth, q);
  }

  @Get()
  list(@Auth() auth: AuthContext, @Query() q: LoanListQuery) {
    return this.loans.list(auth, q.employmentId);
  }

  @Get('book')
  @RequirePermission('payroll.read', 'finance.read')
  book(@Auth() auth: AuthContext, @Query() q: LoanBookQuery) {
    return this.loans.book(auth, q);
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateLoanDto) {
    return this.loans.create(auth, dto);
  }

  @Post(':id/cancel')
  cancel(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.loans.cancel(auth, id);
  }

  @Post(':id/settle')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  settle(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: SettleIouDto, @UploadedFile() file?: UploadedFileLike) {
    return this.loans.submitSettlement(auth, id, dto, file);
  }

  @Get(':id/receipt')
  async receipt(@Auth() auth: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { data, mime, fileName } = await this.loans.receipt(auth, id);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Post(':id/recover')
  @RequirePermission('finance.manage')
  recover(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.loans.recoverUnsettled(auth, id);
  }

  @Post(':id/repayments')
  @RequirePermission('finance.manage')
  repay(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: CashRepaymentDto) {
    return this.loans.recordCash(auth, id, dto);
  }
}
