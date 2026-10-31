import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { VOUCHER_STATUSES, VoucherStatus } from '../common/constants';

const AMOUNT = /^\d+(\.\d{1,4})?$/;
const SIGNED_AMOUNT = /^-?\d+(\.\d{1,4})?$/;

export class VoucherLineDto {
  /** Required, except on an intercompany line, which posts to the current account with the partner */
  @IsOptional()
  @IsInt()
  accountId?: number;

  @IsOptional()
  @Matches(AMOUNT, { message: 'debit must be a positive amount with up to 4 decimals' })
  debit?: string;

  @IsOptional()
  @Matches(AMOUNT, { message: 'credit must be a positive amount with up to 4 decimals' })
  credit?: string;

  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @Matches(/^\d+(\.\d{1,6})?$/, { message: 'exchangeRate must be positive with up to 6 decimals' })
  exchangeRate?: string;

  @IsOptional()
  @Matches(SIGNED_AMOUNT, { message: 'foreignAmount must be an amount, negative for a credit' })
  foreignAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  taxCodeId?: number;

  /** Intercompany: the sister company (e.g. MS-TS) and its account that takes this amount */
  @IsOptional()
  @IsString()
  partnerCompany?: string;

  @IsOptional()
  @IsInt()
  partnerAccountId?: number;

  /** Customer or supplier: required on a Debtors or Creditors Control line */
  @IsOptional()
  @IsInt()
  partyId?: number;

  /** Overrides the due date from the party's payment terms */
  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string;
}

export class SaveVoucherDto {
  @IsDateString({ strict: true })
  txDate: string;

  @IsString()
  @Length(1, 400)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @ValidateNested({ each: true })
  @Type(() => VoucherLineDto)
  @ArrayMaxSize(500)
  lines: VoucherLineDto[];
}

export class InboxDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;
}

export class CommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class RejectDto {
  @IsString()
  @Length(3, 1000, { message: 'Say why the voucher is rejected, so the author can fix it' })
  comment: string;
}

export class ReverseDto {
  /** Defaults to the original journal's date */
  @IsOptional()
  @IsDateString({ strict: true })
  txDate?: string;
}

export class VoucherListQuery {
  @IsOptional()
  @IsIn(VOUCHER_STATUSES)
  status?: VoucherStatus;
}

export class ArchiveQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}
