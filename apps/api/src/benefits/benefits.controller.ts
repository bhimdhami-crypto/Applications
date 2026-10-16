import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { CreatePlanDto, EnrolDto, NominateDto, NomineeQuery, OverviewQuery, PlanQuery, UpdatePlanDto } from './benefits.dto';
import { BenefitsService } from './benefits.service';

/** Meal vouchers, gym memberships and gift vouchers */
@ApiTags('benefits')
@ApiBearerAuth()
@Controller('benefits')
@RequirePermission('self.service')
export class BenefitsController {
  constructor(private readonly benefits: BenefitsService) {}

  @Get('plans')
  @RequirePermission('self.service', 'people.manage', 'payroll.read', 'finance.read')
  plans(@Auth() auth: AuthContext, @Query() q: PlanQuery) {
    return this.benefits.plans(auth, q.entityId);
  }

  @Post('plans')
  @RequirePermission('people.manage')
  createPlan(@Auth() auth: AuthContext, @Body() dto: CreatePlanDto) {
    return this.benefits.createPlan(auth, dto);
  }

  @Patch('plans/:id')
  @RequirePermission('people.manage')
  updatePlan(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.benefits.updatePlan(auth, id, dto);
  }

  @Get('mine')
  mine(@Auth() auth: AuthContext) {
    return this.benefits.mine(auth);
  }

  @Post('enrolments')
  enrol(@Auth() auth: AuthContext, @Body() dto: EnrolDto) {
    return this.benefits.enrol(auth, dto);
  }

  @Post('enrolments/:id/end')
  @RequirePermission('self.service', 'people.manage')
  end(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.benefits.endEnrolment(auth, id);
  }

  @Get('nominees')
  @RequirePermission('team.read', 'people.manage')
  nominees(@Auth() auth: AuthContext, @Query() q: NomineeQuery) {
    return this.benefits.nominees(auth, q.q);
  }

  @Post('vouchers')
  @RequirePermission('team.read', 'people.manage')
  nominate(@Auth() auth: AuthContext, @Body() dto: NominateDto) {
    return this.benefits.nominate(auth, dto);
  }

  @Post('vouchers/:id/cancel')
  @RequirePermission('team.read', 'people.manage')
  cancelVoucher(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.benefits.cancelVoucher(auth, id);
  }

  @Get('overview')
  @RequirePermission('people.manage', 'payroll.read', 'finance.read')
  overview(@Auth() auth: AuthContext, @Query() q: OverviewQuery) {
    return this.benefits.overview(auth, q);
  }
}
