import { ReportStatus, ReportTarget } from '@prisma/client';
import { Transform } from 'class-transformer';
import { Equals, IsEnum, IsOptional, IsString, Length } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class FeedQuery {
  /** Posts older than this post id */
  @IsOptional() @IsString() before?: string;
}

/** Sent as multipart form fields with the files */
export class CreatePostDto {
  @trim() @IsString() @Length(1, 5000) body: string;
  /** POL-20 3.4 and 3.6: the author confirms they may share the files */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @Equals(true, { message: 'Confirm you created the files or have permission to share them' })
  filesConfirmed?: boolean;
}

export class CommentDto {
  @trim() @IsString() @Length(1, 2000) body: string;
}

export class ReportDto {
  @IsEnum(ReportTarget) target: ReportTarget;
  @IsString() targetId: string;
  @trim() @IsString() @Length(3, 500) reason: string;
}

export class ReportsQuery {
  @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
}

export class ReviewDto {
  @IsOptional() @trim() @IsString() @Length(0, 500) note?: string;
}
