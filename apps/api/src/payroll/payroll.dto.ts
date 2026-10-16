import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class PeriodDto {
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
}

export class CreateRunDto extends PeriodDto {
  @IsString() entityId: string;
}

export class RunsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year?: number;
}

export class ReturnRunDto {
  @IsString() @Length(3, 500) note: string;
}

export class RunQuery {
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}
