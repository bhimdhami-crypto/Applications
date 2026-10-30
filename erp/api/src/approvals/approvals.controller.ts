import { Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { VOUCHER_TYPES, VoucherType } from '../common/constants';
import { SaveMatrixDto } from './approvals.dto';
import { ApprovalsService } from './approvals.service';

const DOCUMENT_TYPES = Object.fromEntries(VOUCHER_TYPES.map((t) => [t, t]));

@Controller('companies/:company')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** The active rules, one per document type and amount band */
  @Get('approval-rules')
  rules(@Param('company') company: string) {
    return this.approvals.active(company);
  }

  /** Every document type's bands with checks for gaps and staffing, and the retired versions */
  @Get('approval-matrix')
  matrix(@Param('company') company: string) {
    return this.approvals.matrix(company);
  }

  /** Replaces one document type's matrix. Only administrators change who approves what. */
  @Put('approval-matrix/:documentType')
  @Roles('ADMIN')
  save(
    @Param('company') company: string,
    @Param('documentType', new ParseEnumPipe(DOCUMENT_TYPES)) documentType: VoucherType,
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveMatrixDto,
  ) {
    return this.approvals.saveMatrix(company, documentType, user, dto);
  }
}
