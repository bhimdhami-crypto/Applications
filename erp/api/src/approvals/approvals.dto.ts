import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { ROLES, Role } from '../common/constants';

const AMOUNT = /^\d+(\.\d{1,2})?$/;

export class StageDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsIn(ROLES)
  approverRole: Role;
}

export class BandDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sopReference?: string;

  @Matches(AMOUNT, { message: 'minAmount must be an amount with up to 2 decimals' })
  minAmount: string;

  /** Exclusive upper limit; null for no limit (the top band) */
  @ValidateIf((_, v) => v !== null)
  @Matches(AMOUNT, { message: 'maxAmount must be an amount with up to 2 decimals, or null' })
  maxAmount: string | null;

  @ValidateNested({ each: true })
  @Type(() => StageDto)
  @ArrayMaxSize(6)
  stages: StageDto[];
}

export class SaveMatrixDto {
  @ValidateNested({ each: true })
  @Type(() => BandDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  bands: BandDto[];

  /** Why the approval matrix changed, kept in the audit trail, e.g. "Board resolution 12/2026" */
  @IsString()
  @Length(3, 400, { message: 'Say why the approval rules are changing, for the audit trail' })
  reason: string;
}
