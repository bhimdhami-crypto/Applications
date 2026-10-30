import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DATE_FORMATS, DateFormat } from './statement-csv';

export class CreateBankAccountDto {
  @IsInt()
  glAccountId: number;

  @IsString()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  accountNumber?: string;

  /** The account's currency; the company's home currency when left out */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @IsDateString({ strict: true })
  reconcileFrom: string;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  accountNumber?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  reconcileFrom?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LayoutDto {
  @IsInt()
  headerRow: number;

  @IsString()
  @MaxLength(100)
  date: string;

  @IsString()
  @MaxLength(100)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  amount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  moneyOut?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  moneyIn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  balance?: string | null;

  @IsIn(DATE_FORMATS)
  dateFormat: DateFormat;
}

/** Multipart fields sent with the statement file; layout is JSON text */
export class StatementUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  layout?: string;

  /** The balance before the first line, for files without a balance column */
  @IsOptional()
  @IsNumberString()
  openingBalance?: string;
}

export class WorkspaceQuery {
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export class MatchDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  lineIds: number[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  entryIds: string[];
}

export class LineVoucherDto {
  /** The other side of the entry, such as Bank charges; left for the author to fill in when empty */
  @IsOptional()
  @IsInt()
  contraAccountId?: number;

  /** Needed on a foreign-currency account when no rate is on file for the day */
  @IsOptional()
  @IsNumberString()
  exchangeRate?: string;
}

export class AsAtQuery {
  @IsDateString({ strict: true })
  asAt: string;
}

export class PrepareReconciliationDto {
  @IsDateString({ strict: true })
  asAt: string;

  /** Required when the reconciliation does not balance, to say why */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class LayoutHolder {
  @ValidateNested()
  @Type(() => LayoutDto)
  layout: LayoutDto;
}
