import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateRunDto } from './payroll.dto';
import { PayrollService } from './payroll.service';

@Controller()
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('payroll/runs')
  @Roles(Role.PAYROLL)
  list() {
    return this.payroll.listRuns();
  }

  @Get('payroll/runs/:id')
  @Roles(Role.PAYROLL)
  get(@Param('id') id: string) {
    return this.payroll.getRun(id);
  }

  @Post('payroll/runs')
  @Roles(Role.PAYROLL)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRunDto) {
    return this.payroll.createRun(user.id, dto.companyId, dto.year, dto.month);
  }

  @Post('payroll/runs/:id/recalculate')
  @Roles(Role.PAYROLL)
  recalculate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payroll.recalculate(user.id, id);
  }

  /** Admin only: payroll staff prepare, the admin approves */
  @Post('payroll/runs/:id/approve')
  @Roles(Role.ADMIN)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payroll.approve(user.id, id);
  }

  @Post('payroll/runs/:id/finalize')
  @Roles(Role.ADMIN)
  finalize(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payroll.finalize(user.id, id);
  }

  @Get('payslips/me')
  mine(@CurrentUser() user: AuthUser) {
    return this.payroll.myPayslips(user);
  }

  @Get('payslips/:id')
  payslip(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payroll.getPayslip(user, id);
  }
}
