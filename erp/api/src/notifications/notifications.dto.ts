import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export const EMAIL_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;

export class EmailAlertsDto {
  @IsBoolean()
  emailAlerts: boolean;
}

export class OutboxQuery {
  @IsOptional()
  @IsIn(EMAIL_STATUSES)
  status?: (typeof EMAIL_STATUSES)[number];
}
