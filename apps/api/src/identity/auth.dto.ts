import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

export class VerifyDto {
  @IsString() challengeId: string;
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email' }) code: string;
  /** web keeps the refresh token in an http-only cookie; mobile receives it to keep in the secure keystore */
  @IsOptional() @IsIn(['web', 'mobile']) client?: 'web' | 'mobile';
}

export class RefreshDto {
  @IsOptional() @IsString() @MaxLength(200) refreshToken?: string;
}

/** At least 12 characters with a letter and a digit, as in NIST SP 800-63B plus a basic mix */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{12,128}$/;

export class AcceptInviteDto {
  @IsString() @Length(20, 200) token: string;
  @Matches(PASSWORD_RULE, { message: 'Use at least 12 characters, with letters and numbers' }) password: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @Matches(PASSWORD_RULE, { message: 'Use at least 12 characters, with letters and numbers' }) newPassword: string;
}
