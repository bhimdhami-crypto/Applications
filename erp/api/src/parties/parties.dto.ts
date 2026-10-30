import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PARTY_KINDS, PartyKind } from '../common/constants';

const AMOUNT = /^\d+(\.\d{1,4})?$/;

export class UpdatePartyDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  termsDays?: number;

  @IsOptional()
  @Matches(AMOUNT, { message: 'creditLimit must be a positive amount' })
  creditLimit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePartyDto extends UpdatePartyDto {
  @IsIn(PARTY_KINDS)
  kind: PartyKind;

  @IsString()
  @Length(1, 50)
  code: string;

  @IsString()
  @Length(1, 200)
  declare name: string;
}

export class PartyListQuery {
  @IsOptional()
  @IsIn(PARTY_KINDS)
  kind?: PartyKind;
}
