import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
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
import { ACCOUNT_TYPES, AccountType } from '../common/constants';

const AMOUNT = /^\d+(\.\d{1,4})?$/;
const SIGNED_AMOUNT = /^-?\d+(\.\d{1,4})?$/;

export class CreateAccountDto {
  @IsString()
  @Length(1, 50)
  code: string;

  @IsString()
  @Length(1, 200)
  description: string;

  @IsIn(ACCOUNT_TYPES)
  type: AccountType;

  @IsOptional()
  @IsString()
  parentCode?: string;

  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  costCentre?: string;
}

export class JournalLineDto {
  @IsInt()
  accountId: number;

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
}

export class PostJournalDto {
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
  @Type(() => JournalLineDto)
  @ArrayMinSize(2)
  lines: JournalLineDto[];
}

export class ReverseJournalDto {
  /** Defaults to the original journal's date */
  @IsOptional()
  @IsDateString({ strict: true })
  txDate?: string;
}

export class DateRangeQuery {
  @IsDateString({ strict: true })
  from: string;

  @IsDateString({ strict: true })
  to: string;
}
