import { WorkMode } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ClockInDto {
  @IsEnum(WorkMode) mode: WorkMode;
}

export class WeekQuery {
  @IsOptional() @Matches(DATE) week?: string;
}

export class EditSessionDto {
  @IsDateString() clockIn: string;
  @IsDateString() clockOut: string;
  @trim() @IsString() @Length(3, 200) reason: string;
}

export class WorkLogDto {
  @Matches(DATE, { message: 'date must look like 2026-10-13' }) date: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.25) @Max(24) hours: number;
  @trim() @IsString() @Length(2, 80) project: string;
  @trim() @IsString() @Length(2, 1000) description: string;
}

export class TeamQuery {
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() @Length(0, 80) q?: string;
}

export class ReportQuery {
  @IsOptional() @IsString() companyId?: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-10' }) month: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}
