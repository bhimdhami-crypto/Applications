import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import {
  AsAtQuery,
  CreateBankAccountDto,
  LineVoucherDto,
  MatchDto,
  PrepareReconciliationDto,
  StatementUploadDto,
  UpdateBankAccountDto,
  WorkspaceQuery,
} from './bank.dto';
import { BankService } from './bank.service';

// A statement is dropped as one multipart file under the field "file"
const FILE = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } });

@Controller('companies/:company/bank-accounts')
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Get()
  list(@Param('company') company: string) {
    return this.bank.list(company);
  }

  @Post()
  @Roles('FINANCE_MANAGER')
  create(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateBankAccountDto) {
    return this.bank.create(company, user, dto);
  }

  @Patch(':id')
  @Roles('FINANCE_MANAGER')
  update(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Body() dto: UpdateBankAccountDto) {
    return this.bank.update(company, id, user, dto);
  }

  @Post(':id/statements/preview')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  @HttpCode(200)
  @UseInterceptors(FILE)
  preview(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: StatementUploadDto,
  ) {
    return this.bank.preview(company, id, file, dto.layout, dto.openingBalance);
  }

  @Post(':id/statements')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  @UseInterceptors(FILE)
  import(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: StatementUploadDto,
  ) {
    return this.bank.import(company, id, user, file, dto.layout, dto.openingBalance);
  }

  @Get(':id/statements')
  statements(@Param('company') company: string, @Param('id', ParseIntPipe) id: number) {
    return this.bank.statements(company, id);
  }

  @Get(':id/statements/:statementId/download')
  async download(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('statementId', ParseIntPipe) statementId: number,
    @Res() res: Response,
  ) {
    const { fileName, data } = await this.bank.statementFile(company, id, statementId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(data);
  }

  @Get(':id/workspace')
  workspace(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @Query() q: WorkspaceQuery) {
    return this.bank.workspace(company, id, q.to);
  }

  @Post(':id/auto-match')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  @HttpCode(200)
  autoMatch(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.bank.autoMatch(company, id, user);
  }

  @Post(':id/matches')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  match(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Body() dto: MatchDto) {
    return this.bank.match(company, id, user, dto);
  }

  @Delete(':id/matches/:matchId')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  unmatch(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('matchId', ParseIntPipe) matchId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bank.unmatch(company, id, matchId, user);
  }

  @Post(':id/lines/:lineId/voucher')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  voucherForLine(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: LineVoucherDto,
  ) {
    return this.bank.voucherForLine(company, id, lineId, user, dto);
  }

  @Get(':id/reconciliation')
  reconciliation(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @Query() q: AsAtQuery) {
    return this.bank.reconciliation(company, id, q.asAt);
  }

  @Get(':id/reconciliations')
  reconciliations(@Param('company') company: string, @Param('id', ParseIntPipe) id: number) {
    return this.bank.reconciliations(company, id);
  }

  @Post(':id/reconciliations')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  prepare(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Body() dto: PrepareReconciliationDto) {
    return this.bank.prepare(company, id, user, dto);
  }

  @Post(':id/reconciliations/:reconId/review')
  @Roles('FINANCE_MANAGER', 'DIRECTOR')
  @HttpCode(200)
  review(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('reconId', ParseIntPipe) reconId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.bank.review(company, id, reconId, user);
  }
}
