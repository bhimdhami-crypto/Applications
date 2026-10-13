import { DocumentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

/** Fields an employee may change on their own record */
export class UpdatePersonalDto {
  @IsOptional() @IsString() @Length(4, 40) mobilePhone?: string;
  @IsOptional() @IsEmail() personalEmail?: string;
  @IsOptional() @IsString() @Length(1, 40) maritalStatus?: string;
  @IsOptional() @IsInt() @Min(0) @Max(30) dependants?: number;
}

export class NextOfKinDto {
  @IsString() @Length(1, 120) name: string;
  @IsString() @Length(1, 60) relationship: string;
  @IsString() @Length(4, 40) phone: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() isEmergencyContact?: boolean;
  @IsOptional() @IsBoolean() isBeneficiary?: boolean;
}

export class ReplaceNextOfKinDto {
  @ValidateNested({ each: true }) @Type(() => NextOfKinDto) @ArrayMaxSize(5) contacts: NextOfKinDto[];
}

/** Sent as multipart form fields next to the file */
export class UploadDocumentDto {
  @IsString() @Length(1, 80) type: string;
  @IsOptional() @IsDateString() issuedDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  /** HR only: hide the document from the employee */
  @IsOptional() @IsString() hrOnly?: string;
}

export class UpdateDocumentDto {
  @IsEnum(DocumentStatus) status: DocumentStatus;
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
  'Driving licence',
  'Work permit',
  'Exit clearance and certificate of service',
  'Employee profile summary',
  'Other',
];
