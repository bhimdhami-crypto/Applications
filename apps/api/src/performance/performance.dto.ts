import { GoalStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCycleDto {
  @IsString() @Length(3, 120) name: string;
  @IsString() companyId: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsDateString() selfDueOn: string;
  @IsDateString() managerDueOn: string;
}

export class CycleQuery {
  @IsOptional() @IsString() companyId?: string;
}

export class SubmitReviewDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsString() @Length(10, 4000) comments: string;
}

export class GoalQuery {
  @IsOptional() @IsString() employeeId?: string;
}

export class CreateGoalDto {
  /** Leave out for your own goal; managers set goals for direct reports, HR for anyone */
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() cycleId?: string;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
  @IsOptional() @IsDateString() dueOn?: string;
}

export class UpdateGoalDto {
  @IsOptional() @IsString() @Length(3, 200) title?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @IsEnum(GoalStatus) status?: GoalStatus;
  @IsOptional() @IsDateString() dueOn?: string;
}
