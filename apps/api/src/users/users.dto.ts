import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Role, ROLES, ScopeType } from '@gpp/shared';

export class GrantDto {
  @IsIn(ROLES) role: Role;
  @IsIn(['GROUP', 'COUNTRY', 'LEGAL_ENTITY']) scopeType: ScopeType;
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() legalEntityId?: string;
}

export class CreateUserDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(2) @MaxLength(120) displayName: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => GrantDto) roles: GrantDto[];
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UserListQuery {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
