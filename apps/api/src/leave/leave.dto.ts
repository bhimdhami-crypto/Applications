import { LeaveType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

/** Sent as multipart form fields, so an optional medical certificate can come with it */
export class CreateLeaveDto {
  @IsEnum(LeaveType) type: LeaveType;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
  @IsOptional() @IsString() @Length(0, 120) handoverTo?: string;
  @IsOptional() @IsString() @Length(0, 120) contactWhileAway?: string;
  /** HR only: record leave for someone else in their company; it is approved at once */
  @IsOptional() @IsString() employmentId?: string;
}

export class DecideLeaveDto {
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class LeavePreviewQuery {
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() employmentId?: string;
}

export class LeaveListQuery {
  @IsOptional() @IsString() employmentId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2016) @Max(2100) year?: number;
}

export class CalendarQuery {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month: string;
  /** HR: the company to show. Others always see their own circle. */
  @IsOptional() @IsString() entityId?: string;
}

export class HolidayQuery {
  @Matches(/^[A-Z]{2}$/) countryCode: string;
  @Type(() => Number) @IsInt() @Min(2016) @Max(2100) year: number;
}

export class CreateHolidayDto {
  @Matches(/^[A-Z]{2}$/) countryCode: string;
  @IsDateString() date: string;
  @IsString() @Length(1, 120) name: string;
}

export class CreateAdjustmentDto {
  @IsString() employmentId: string;
  @IsEnum(LeaveType) type: LeaveType;
  @IsInt() @Min(2016) @Max(2100) year: number;
  @IsInt() @Min(-60) @Max(60) days: number;
  @IsString() @Length(3, 200) reason: string;
}
