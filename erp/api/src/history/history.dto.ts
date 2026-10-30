import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Records whose own history can be opened from their screen */
export const HISTORY_ENTITIES = ['Voucher', 'Party', 'GlAccount', 'PostingBatch', 'ApprovalRule', 'IntercompanyLink', 'BankAccount'] as const;
export type HistoryEntity = (typeof HISTORY_ENTITIES)[number];

export class HistoryQuery {
  @IsOptional()
  @IsIn(HISTORY_ENTITIES)
  entity?: HistoryEntity;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  /** Matches the record (voucher number, account code, customer) or the action */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** The id of the last entry already shown, to fetch the next, older page */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class SignInQuery {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  before?: string;
}
