import { PartialType, OmitType } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const CODE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const CODE_MSG = 'Use 2 to 30 capital letters, digits, - or _';

export class CreateCurrencyDto {
  @Matches(/^[A-Z]{3}$/, { message: 'Use the 3-letter ISO 4217 code' }) code: string;
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  @IsInt() @Min(0) @Max(4) decimals: number;
  @IsString() @MinLength(1) @MaxLength(5) symbol: string;
}

export class UpdateCurrencyDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5) symbol?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateCountryDto {
  @Matches(/^[A-Z]{2}$/, { message: 'Use the 2-letter ISO 3166 code' }) code: string;
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @Matches(/^[A-Z]{3}$/) currencyCode: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @IsString({ each: true }) languages: string[];
  @IsString() timeZone: string;
  @IsArray() @ArrayMaxSize(3) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekendDays: number[];
  @IsIn(['Africa', 'Europe', 'Asia', 'Oceania', 'Americas']) region: string;
}

export class UpdateCountryDto extends PartialType(OmitType(CreateCountryDto, ['code', 'currencyCode'] as const)) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateEntityDto {
  @Matches(CODE, { message: CODE_MSG }) code: string;
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @Matches(/^[A-Z]{2}$/) countryCode: string;
  /** Defaults to the country's currency */
  @IsOptional() @Matches(/^[A-Z]{3}$/) functionalCurrency?: string;
  @IsOptional() @IsString() @MaxLength(60) registrationNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() timeZone?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekendDays?: number[];
  @IsOptional() @IsString() defaultLanguage?: string;
  @IsOptional() @IsInt() @Min(1) @Max(12) fiscalYearStartMonth?: number;
  @IsOptional() @IsBoolean() isSharedServiceCentre?: boolean;
}

export class UpdateEntityDto extends PartialType(OmitType(CreateEntityDto, ['code', 'countryCode', 'functionalCurrency'] as const)) {
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}

export class CreateBusinessUnitDto {
  @Matches(CODE, { message: CODE_MSG }) code: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
}

export class CreateBranchDto extends CreateBusinessUnitDto {
  @IsString() @MinLength(2) @MaxLength(80) city: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() timeZone?: string;
}

export class CreateDepartmentDto extends CreateBusinessUnitDto {
  @IsOptional() @IsString() businessUnitId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() parentId?: string;
}

export class CreateCostCentreDto extends CreateBusinessUnitDto {
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(40) glCode?: string;
}

export class UpdateStructureDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(40) glCode?: string;
}

export class SetFeatureDto {
  @IsBoolean() enabled: boolean;
}

export class EntityListQuery {
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(80) q?: string;
}

export const STRUCTURE_KINDS = ['business-units', 'branches', 'departments', 'cost-centres'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export class StructureKindParam {
  @IsIn(STRUCTURE_KINDS) kind: StructureKind;
  @IsString() @MinLength(1) id: string;
}
