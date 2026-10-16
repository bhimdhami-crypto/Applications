import { ApiPropertyOptional } from '@nestjs/swagger';
import { ChangeRequestStatus, DocumentStatus, EmploymentType, WorkLocation } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumberString, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Money as a decimal string, never a float */
const MONEY = /^\d{1,14}(\.\d{1,4})?$/;

export class EmployeeListQuery {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() @Length(1, 80) @Transform(trim) q?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'TERMINATED', 'ALL']) status?: 'ACTIVE' | 'TERMINATED' | 'ALL';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class HeadcountQuery {
  @IsOptional() @IsString() entityId?: string;
}

export class CreateEmployeeDto {
  @IsString() legalEntityId: string;
  @IsString() @Length(1, 80) @Transform(trim) firstName: string;
  @IsString() @Length(1, 80) @Transform(trim) lastName: string;
  @IsOptional() @IsString() @Length(1, 120) localName?: string;
  @IsOptional() @IsIn(['Female', 'Male', 'Non-binary', 'Not stated']) gender?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) nationality?: string;
  @IsOptional() @IsEmail() personalEmail?: string;
  @IsOptional() @IsString() @Length(4, 40) mobilePhone?: string;
  @IsOptional() @IsEmail() workEmail?: string;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsDateString() hireDate: string;
  @IsString() @Length(1, 120) @Transform(trim) jobTitle: string;
  @IsOptional() @IsString() gradeCode?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() costCentreId?: string;
  @IsOptional() @IsString() managerId?: string;
  @ApiPropertyOptional({ description: 'Monthly base pay as a decimal string, in the company currency' })
  @IsOptional() @Matches(MONEY, { message: 'baseAmount must be a positive decimal such as 125000.00' }) baseAmount?: string;
  @IsOptional() @Matches(MONEY, { message: 'allowances must be a positive decimal' }) allowances?: string;
}

/** Fields employees may change themselves; the rest need HR */
export const SELF_EDITABLE = ['preferredName', 'mobilePhone', 'personalEmail', 'maritalStatus', 'dependants', 'highestQualification', 'institution', 'qualificationYear'] as const;

export class UpdatePersonalDto {
  @IsOptional() @IsString() @Length(1, 80) @Transform(trim) preferredName?: string;
  @IsOptional() @IsString() @Length(4, 40) mobilePhone?: string;
  @IsOptional() @IsEmail() personalEmail?: string;
  @IsOptional() @IsIn(['Single', 'Married', 'Divorced', 'Widowed', 'Civil partnership', 'Not stated']) maritalStatus?: string;
  @IsOptional() @IsInt() @Min(0) @Max(30) dependants?: number;
  @IsOptional() @IsString() @Length(1, 120) highestQualification?: string;
  @IsOptional() @IsString() @Length(1, 120) institution?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) qualificationYear?: number;
  // HR only
  @IsOptional() @IsString() @Length(1, 80) @Transform(trim) firstName?: string;
  @IsOptional() @IsString() @Length(1, 80) @Transform(trim) lastName?: string;
  @IsOptional() @IsString() @Length(1, 120) localName?: string;
  @IsOptional() @IsIn(['Female', 'Male', 'Non-binary', 'Not stated']) gender?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) nationality?: string;
}

export class ContactDto {
  @IsString() @Length(1, 120) @Transform(trim) name: string;
  @IsString() @Length(1, 60) relationship: string;
  @IsString() @Length(4, 40) phone: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() isEmergencyContact?: boolean;
  @IsOptional() @IsBoolean() isBeneficiary?: boolean;
}

export class ReplaceContactsDto {
  @ValidateNested({ each: true }) @Type(() => ContactDto) @ArrayMaxSize(5) contacts: ContactDto[];
}

export class UpdateEmploymentDto {
  @IsOptional() @IsEmail() workEmail?: string;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(WorkLocation) workLocation?: WorkLocation;
  @IsOptional() @IsDateString() probationEndDate?: string;
}

export const ASSIGNMENT_REASONS = ['PROMOTION', 'TRANSFER', 'CHANGE', 'CORRECTION'] as const;

/** A new job record from a date. Anything left out is copied from the current record. */
export class NewAssignmentDto {
  @IsDateString() effectiveFrom: string;
  @IsIn(ASSIGNMENT_REASONS) reason: (typeof ASSIGNMENT_REASONS)[number];
  @IsOptional() @IsString() @Length(1, 120) @Transform(trim) jobTitle?: string;
  @IsOptional() @IsString() gradeCode?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() costCentreId?: string;
  /** Empty string removes the manager */
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsNumberString() fte?: string;
}

export const PAY_REASONS = ['PROMOTION', 'ANNUAL_REVIEW', 'MARKET_ADJUSTMENT', 'CHANGE', 'CORRECTION'] as const;

export class NewCompensationDto {
  @IsDateString() effectiveFrom: string;
  @Matches(MONEY, { message: 'baseAmount must be a positive decimal such as 125000.00' }) baseAmount: string;
  @IsOptional() @Matches(MONEY, { message: 'allowances must be a positive decimal' }) allowances?: string;
  @IsIn(PAY_REASONS) reason: (typeof PAY_REASONS)[number];
}

export class TerminateDto {
  @IsDateString() endDate: string;
  @IsString() @Length(3, 200) @Transform(trim) exitReason: string;
}

export class UploadDocumentDto {
  @IsString() @Length(1, 80) type: string;
  @IsOptional() @IsDateString() issuedDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  /** Multipart fields arrive as text: "true" hides the document from the employee (HR only) */
  @IsOptional() @IsIn(['true', 'false']) hrOnly?: string;
}

export class UpdateDocumentDto {
  @IsEnum(DocumentStatus) status: DocumentStatus;
}

export class BankChangeDto {
  @IsString() @Length(2, 80) @Transform(trim) bankName: string;
  @IsOptional() @IsString() @Length(1, 20) branchCode?: string;
  @IsString() @Length(2, 120) @Transform(trim) accountName: string;
  @IsString() @Matches(/^[A-Za-z0-9 -]{6,34}$/, { message: 'Enter the account number or IBAN using letters, digits and spaces' }) accountNumber: string;
}

export class ChangeRequestQuery {
  @IsOptional() @IsEnum(ChangeRequestStatus) status?: ChangeRequestStatus;
  @IsOptional() @IsString() entityId?: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @Length(1, 500) note?: string;
}

export const DOCUMENT_TYPES = [
  'National ID or passport',
  'Tax ID certificate',
  'Social security registration',
  'Highest education certificate',
  'Professional certification',
  'Offer letter',
  'Employment contract',
  'NDA and IP assignment',
  'Bank details confirmation',
  'Next of kin and beneficiary form',
  'Background check report',
  'Policy acknowledgements',
  "Dependants' birth certificates",
  'Remote work agreement',
  'Medical fitness certificate',
  'Medical certificate (sick leave)',
  'Leave supporting document',
  'IOU receipts',
  'Driving licence',
  'Work permit',
  'Exit clearance and certificate of service',
  'Employee profile summary',
  'Other',
];
