import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreatePlanDto, EnrolDto, NominateDto, NomineeQuery, OverviewQuery, PlanQuery, UpdatePlanDto } from './benefits.dto';
import { BenefitsService } from './benefits.service';

/** Meal vouchers, gym memberships and gift vouchers */
@Controller('benefits')
export class BenefitsController {
  constructor(private readonly benefits: BenefitsService) {}

  @Get('plans')
  plans(@CurrentUser() user: AuthUser, @Query() q: PlanQuery) {
    return this.benefits.plans(user, q.companyId);
  }

  @Post('plans')
  @Roles(Role.HR)
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.benefits.createPlan(user, dto);
  }

  @Patch('plans/:id')
  @Roles(Role.HR)
  updatePlan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.benefits.updatePlan(user, id, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.benefits.mine(user);
  }

  @Post('enrolments')
  enrol(@CurrentUser() user: AuthUser, @Body() dto: EnrolDto) {
    return this.benefits.enrol(user, dto);
  }

  @Post('enrolments/:id/end')
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.benefits.endEnrolment(user, id);
  }

  @Get('nominees')
  @Roles(Role.HR, Role.MANAGER)
  nominees(@CurrentUser() user: AuthUser, @Query() q: NomineeQuery) {
    return this.benefits.nominees(user, q.q);
  }

  @Post('vouchers')
  @Roles(Role.HR, Role.MANAGER)
  nominate(@CurrentUser() user: AuthUser, @Body() dto: NominateDto) {
    return this.benefits.nominate(user, dto);
  }

  @Post('vouchers/:id/cancel')
  cancelVoucher(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.benefits.cancelVoucher(user, id);
  }

  @Get('overview')
  @Roles(Role.HR, Role.PAYROLL, Role.FINANCE)
  overview(@CurrentUser() user: AuthUser, @Query() q: OverviewQuery) {
    return this.benefits.overview(user, q);
  }
}
