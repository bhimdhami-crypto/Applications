import { Role, WorkLocation } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

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
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @Length(1, 120) jobTitle?: string;
  @IsOptional() @IsString() @Length(1, 120) department?: string;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyBasic?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) monthlyAllowances?: number;
  @IsOptional() @IsString() managerId?: string;
}

export class DeleteEmployeeDto {
  @IsOptional() @IsDateString() exitDate?: string;
  @IsOptional() @IsString() @Length(1, 200) reason?: string;
}
