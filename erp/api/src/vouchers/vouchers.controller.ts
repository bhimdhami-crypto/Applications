import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ArchiveService } from '../archive/archive.service';
import { MAX_FILE_BYTES } from '../archive/file-types';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import {
  ArchiveQuery,
  CommentDto,
  CreateApprovalRuleDto,
  InboxDto,
  RejectDto,
  ReverseDto,
  SaveVoucherDto,
  VoucherListQuery,
} from './vouchers.dto';
import { VouchersService } from './vouchers.service';

// Drag and drop sends files as multipart form data under the field "files"
const FILES = FilesInterceptor('files', 20, { limits: { fileSize: MAX_FILE_BYTES } });

@Controller()
export class VouchersController {
  constructor(
    private readonly vouchers: VouchersService,
    private readonly archive: ArchiveService,
  ) {}

  @Get('approvals/pending')
  pending(@CurrentUser() user: AuthUser) {
    return this.vouchers.pending(user);
  }

  @Get('companies/:company/vouchers')
  list(@Param('company') company: string, @Query() q: VoucherListQuery) {
    return this.vouchers.list(company, q.status);
  }

  @Post('companies/:company/vouchers')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: SaveVoucherDto) {
    return this.vouchers.create(company, user, dto);
  }

  @Post('companies/:company/inbox')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  @UseInterceptors(FILES)
  inbox(
    @Param('company') company: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: InboxDto,
  ) {
    return this.vouchers.inbox(company, user, files, dto.description);
  }

  @Get('companies/:company/vouchers/:no')
  get(@Param('company') company: string, @Param('no') no: string) {
    return this.vouchers.get(company, no);
  }

  @Put('companies/:company/vouchers/:no')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  update(@Param('company') company: string, @Param('no') no: string, @CurrentUser() user: AuthUser, @Body() dto: SaveVoucherDto) {
    return this.vouchers.update(company, no, user, dto);
  }

  @Post('companies/:company/vouchers/:no/submit')
  @HttpCode(200)
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  submit(@Param('company') company: string, @Param('no') no: string, @CurrentUser() user: AuthUser, @Body() dto: CommentDto) {
    return this.vouchers.submit(company, no, user, dto.comment);
  }

  @Post('companies/:company/vouchers/:no/approve')
  @HttpCode(200)
  approve(@Param('company') company: string, @Param('no') no: string, @CurrentUser() user: AuthUser, @Body() dto: CommentDto) {
    return this.vouchers.approve(company, no, user, dto.comment);
  }

  @Post('companies/:company/vouchers/:no/reject')
  @HttpCode(200)
  reject(@Param('company') company: string, @Param('no') no: string, @CurrentUser() user: AuthUser, @Body() dto: RejectDto) {
    return this.vouchers.reject(company, no, user, dto.comment);
  }

  @Post('companies/:company/vouchers/:no/recall')
  @HttpCode(200)
  recall(@Param('company') company: string, @Param('no') no: string, @CurrentUser() user: AuthUser) {
    return this.vouchers.recall(company, no, user);
  }

  @Post('companies/:company/vouchers/:no/cancel')
  @HttpCode(200)
  cancel(@Param('company') company: string, @Param('no') no: string, @CurrentUser() user: AuthUser) {
    return this.vouchers.cancel(company, no, user);
  }

  @Post('companies/:company/vouchers/:no/attachments')
  @UseInterceptors(FILES)
  attach(
    @Param('company') company: string,
    @Param('no') no: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: InboxDto,
  ) {
    return this.vouchers.attach(company, no, user, files, dto.description);
  }

  @Delete('companies/:company/vouchers/:no/attachments/:id')
  removeAttachment(
    @Param('company') company: string,
    @Param('no') no: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vouchers.removeAttachment(company, no, id, user);
  }

  @Post('companies/:company/journals/:auditNo/reverse')
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  reverse(@Param('company') company: string, @Param('auditNo') auditNo: string, @CurrentUser() user: AuthUser, @Body() dto: ReverseDto) {
    return this.vouchers.reverse(company, auditNo, user, dto.txDate);
  }

  @Get('companies/:company/archive')
  search(@Param('company') company: string, @Query() q: ArchiveQuery) {
    return this.archive.search(company, q.q, q.from, q.to);
  }

  @Get('companies/:company/archive/:id/download')
  async download(@Param('company') company: string, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { row, data } = await this.archive.download(company, id);
    res.set({
      'Content-Type': row.contentType,
      'Content-Length': String(data.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
    });
    res.send(data);
  }

  @Get('companies/:company/approval-rules')
  rules(@Param('company') company: string) {
    return this.vouchers.rules(company);
  }

  @Post('companies/:company/approval-rules')
  @Roles('ADMIN')
  createRule(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateApprovalRuleDto) {
    return this.vouchers.createRule(company, user, dto);
  }
}
