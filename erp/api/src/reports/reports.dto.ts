import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PARTY_KINDS, PartyKind } from '../common/constants';

export class GeneralLedgerQuery {
  @IsDateString({ strict: true })
  from: string;

  @IsDateString({ strict: true })
  to: string;

  /** One account code; all accounts with a balance or movement when left out */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  account?: string;
}

export class AgedQuery {
  @IsIn(PARTY_KINDS)
  kind: PartyKind;

  @IsDateString({ strict: true })
  asAt: string;
}

export class StatementQuery {
  @Type(() => Number)
  @IsInt()
  party: number;

  @IsDateString({ strict: true })
  from: string;

  @IsDateString({ strict: true })
  to: string;
}
