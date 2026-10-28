import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/decorators';
import { AnalyticsService } from './analytics.service';

class WorkforceQuery {
  @IsOptional() @IsString() companyId?: string;
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Headcount, movement, demographics and payroll status. HR, payroll and admins. */
  @Get('workforce')
  @Roles(Role.HR, Role.PAYROLL)
  workforce(@Query() query: WorkforceQuery) {
    return this.analytics.workforce(query.companyId || undefined);
  }
}
