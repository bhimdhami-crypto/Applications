import { LoanKind, LoanProduct, RequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class LoanQuoteQuery {
  @IsEnum(LoanKind) kind: LoanKind;
  @IsOptional() @IsEnum(LoanProduct) product?: LoanProduct;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1_000_000_000) amount: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36) months?: number;
}

/** HR-F02 salary advance, HR-F03 staff loan or HR-F04 IOU */
export class CreateLoanDto {
  @IsEnum(LoanKind) kind: LoanKind;
  @IsOptional() @IsEnum(LoanProduct) product?: LoanProduct;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(1_000_000_000) amount: number;
  @IsOptional() @IsInt() @Min(1) @Max(36) months?: number;
  @IsString() @Length(3, 500) purpose: string;
  @IsOptional() @IsString() @Length(0, 160) guarantor?: string;
  @IsOptional() @IsString() @Length(0, 60) costCentre?: string;
  @IsOptional() @IsDateString() neededOn?: string;
  @IsOptional() @IsDateString() settleBy?: string;
}

/** Sent as multipart form fields with the receipts */
export class SettleIouDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) spent: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000_000) cashReturned: number;
}

export class CashRepaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1_000_000_000) amount: number;
  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class LoanListQuery {
  @IsOptional() @IsString() employeeId?: string;
}

export class LoanBookQuery {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(LoanKind) kind?: LoanKind;
  @IsOptional() @IsEnum(RequestStatus) status?: RequestStatus;
}
