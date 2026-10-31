import { CandidateStage, EmploymentType, OpeningStatus, WorkLocation } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class OpeningQuery {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(OpeningStatus) status?: OpeningStatus;
}

export class CreateOpeningDto {
  @IsString() companyId: string;
  @IsString() @Length(2, 120) title: string;
  @IsString() @Length(1, 120) department: string;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsString() @Length(1, 20) grade?: string;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) positions?: number;
  @IsOptional() @IsString() hiringManagerId?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salaryMin?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salaryMax?: number;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsDateString() closesOn?: string;
}

export class UpdateOpeningDto {
  @IsOptional() @IsString() @Length(2, 120) title?: string;
  @IsOptional() @IsString() @Length(1, 120) department?: string;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsString() @Length(1, 20) grade?: string;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) positions?: number;
  @IsOptional() @IsString() hiringManagerId?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salaryMin?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) salaryMax?: number;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsOptional() @IsDateString() closesOn?: string;
  @IsOptional() @IsEnum(OpeningStatus) status?: OpeningStatus;
}

export class CreateCandidateDto {
  @IsString() @Length(1, 80) firstName: string;
  @IsString() @Length(1, 80) lastName: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @Length(4, 40) phone?: string;
  @IsOptional() @IsString() @Length(1, 60) source?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class MoveCandidateDto {
  @IsOptional() @IsEnum(CandidateStage) stage?: CandidateStage;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class HireCandidateDto {
  @IsDateString() hireDate: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyBasic: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyAllowances?: number;
  /** Work email for the new login; the candidate's own email is used when left out */
  @IsOptional() @IsEmail() workEmail?: string;
}
