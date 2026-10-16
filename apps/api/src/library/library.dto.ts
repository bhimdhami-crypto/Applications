import { LibraryKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));

export class LibraryQuery {
  @IsOptional() @IsEnum(LibraryKind) kind?: LibraryKind;
}

/** Sent as multipart form fields with the PDF */
export class CreateItemDto {
  @IsEnum(LibraryKind) kind: LibraryKind;
  @Matches(/^(POL-\d{2,3}|HR-F\d{2,3})$/, { message: 'code must look like POL-23 or HR-F21' }) code: string;
  @IsString() @Length(3, 120) title: string;
  @IsString() @Length(2, 60) category: string;
  @IsOptional() @IsString() @Length(0, 400) summary?: string;
  @IsOptional() @IsString() @Length(0, 80) owner?: string;
  @Matches(/^\d{1,3}(\.\d{1,3}){0,2}$/, { message: 'version must look like 1.0' }) version: string;
  @IsOptional() @bool() @IsBoolean() mustRead?: boolean;
}

export class NewVersionDto {
  @Matches(/^\d{1,3}(\.\d{1,3}){0,2}$/, { message: 'version must look like 1.1' }) version: string;
  /** Minor fixes (typos, layout) keep everyone's earlier confirmation */
  @IsOptional() @bool() @IsBoolean() keepAcknowledgements?: boolean;
}

export class UpdateItemDto {
  @IsOptional() @IsString() @Length(3, 120) title?: string;
  @IsOptional() @IsString() @Length(2, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 400) summary?: string;
  @IsOptional() @IsString() @Length(0, 80) owner?: string;
  @IsOptional() @IsBoolean() mustRead?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ReportQuery {
  @IsOptional() @IsString() entityId?: string;
}
