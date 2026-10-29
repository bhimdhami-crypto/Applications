import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ACCOUNT_TYPES, AccountType } from '../common/constants';

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

export class DateRangeQuery {
  @IsDateString({ strict: true })
  from: string;

  @IsDateString({ strict: true })
  to: string;
}

export class CreateIntercompanyLinkDto {
  /** The sister company, e.g. MFI-MDS */
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
