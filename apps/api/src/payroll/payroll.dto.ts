import { IsInt, IsString, Max, Min } from 'class-validator';

export class CreateRunDto {
  @IsString() companyId: string;
  @IsInt() @Min(2016) @Max(2100) year: number;
  @IsInt() @Min(1) @Max(12) month: number;
}
