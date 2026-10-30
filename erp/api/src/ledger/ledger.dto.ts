import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ACCOUNT_TYPES, AccountType, SUBLEDGERS, Subledger } from '../common/constants';

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

  /** AR for Debtors Control, AP for Creditors Control */
  @IsOptional()
  @IsIn(SUBLEDGERS)
  subledger?: Subledger;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** AR, AP, or null to make it a plain account again */
  @IsOptional()
  @IsIn([...SUBLEDGERS, null])
  subledger?: Subledger | null;
}

export class DateRangeQuery {
  @IsDateString({ strict: true })
  from: string;

  @IsDateString({ strict: true })
  to: string;
}

export class CreateIntercompanyLinkDto {
  /** The sister company, e.g. MS-TS */
  @IsString()
  partnerCode: string;

  /** This company's current account with the partner */
  @IsInt()
  accountId: number;
}

export class AsAtQuery {
  @IsDateString({ strict: true })
  to: string;
}
