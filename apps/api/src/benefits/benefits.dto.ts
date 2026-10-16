import { BenefitKind, VoucherOccasion, WorkLocation } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class PlanQuery {
  @IsOptional() @IsString() entityId?: string;
}

export class CreatePlanDto {
  @IsString() entityId: string;
  @IsEnum(BenefitKind) kind: BenefitKind;
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() @Length(0, 120) provider?: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) companyShare: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) employeeShare: number;
  @IsOptional() @IsBoolean() paidAsCash?: boolean;
  @IsOptional() @IsArray() @IsEnum(WorkLocation, { each: true }) workLocations?: WorkLocation[];
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @Length(0, 120) provider?: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) companyShare?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) employeeShare?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** HR-F06 meal voucher or HR-F07 gym membership */
export class EnrolDto {
  @IsString() planId: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'startMonth must look like 2026-11' }) startMonth: string;
  @IsOptional() @IsString() @Length(0, 200) dietaryNeeds?: string;
  @IsOptional() @IsString() @Length(0, 120) branch?: string;
  @IsOptional() @IsString() @Length(0, 160) emergencyContact?: string;
}

/** HR-F05 gift voucher nomination */
export class NominateDto {
  @IsString() employmentId: string;
  @IsEnum(VoucherOccasion) occasion: VoucherOccasion;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10_000_000) value: number;
  @IsOptional() @IsString() @Length(0, 120) partner?: string;
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

export class NomineeQuery {
  @IsOptional() @IsString() @Length(0, 80) q?: string;
}

export class OverviewQuery {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2016) @Max(2100) year?: number;
}
