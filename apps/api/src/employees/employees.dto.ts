import { EmploymentStatus, EmploymentType, Role, WorkLocation } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateEmployeeDto {
  @IsString() @Length(1, 80) firstName: string;
  @IsString() @Length(1, 80) lastName: string;
  @IsEmail() email: string;
  @IsString() @Length(1, 120) jobTitle: string;
  @IsString() @Length(1, 120) department: string;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsDateString() hireDate: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyBasic: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyAllowances?: number;
  @IsString() companyId: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsString() @Length(1, 20) grade?: string;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsString() @Length(4, 40) mobilePhone?: string;
}

export class ListEmployeesQuery {
  /** Search by name, employee number, email or job title */
  @IsOptional() @IsString() @Length(1, 80) q?: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(EmploymentStatus) status?: EmploymentStatus;
  @IsOptional() @IsString() includeLeavers?: string;
  /** Only people whose portal login has this role, e.g. MANAGER for the manager picker */
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @Length(1, 120) jobTitle?: string;
  @IsOptional() @IsString() @Length(1, 120) department?: string;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyBasic?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyAllowances?: number;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() @Length(1, 20) grade?: string;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsString() @Length(1, 20) gender?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() @Length(1, 60) nationalIdNumber?: string;
  @IsOptional() @IsString() @Length(1, 60) taxId?: string;
  @IsOptional() @IsString() @Length(1, 60) socialSecurityNo?: string;
  @IsOptional() @IsString() @Length(1, 120) highestQualification?: string;
  @IsOptional() @IsString() @Length(1, 120) institution?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) qualificationYear?: number;
}

export class DeleteEmployeeDto {
  @IsOptional() @IsDateString() exitDate?: string;
  @IsOptional() @IsString() @Length(1, 200) reason?: string;
}
