import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { CreateRunDto, PeriodDto, ReturnRunDto, RunsQuery } from './payroll.dto';
import { PayrollService } from './payroll.service';

/** Month-end payroll runs, with maker and checker */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/runs')
@RequirePermission('payroll.read')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  overview(@Auth() auth: AuthContext, @Query() q: RunsQuery) {
    return this.payroll.overview(auth, q.year);
  }

  @Post()
  @RequirePermission('payroll.prepare')
  create(@Auth() auth: AuthContext, @Body() dto: CreateRunDto) {
    return this.payroll.create(auth, dto);
  }

  @Post('all')
  @RequirePermission('payroll.prepare')
  createAll(@Auth() auth: AuthContext, @Body() dto: PeriodDto) {
    return this.payroll.createAll(auth, dto);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.get(auth, id);
  }

  @Get(':id/register')
  async register(@Auth() auth: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { fileName, csv } = await this.payroll.register(auth, id);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` });
    return csv;
  }

  @Post(':id/recalculate')
  @RequirePermission('payroll.prepare')
  recalculate(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.recalculate(auth, id);
  }

  @Post(':id/submit')
  @RequirePermission('payroll.prepare')
  submit(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.submit(auth, id);
  }

  @Delete(':id')
  @RequirePermission('payroll.prepare')
  remove(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.remove(auth, id);
  }

  @Post(':id/approve')
  @RequirePermission('payroll.approve')
  approve(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.approve(auth, id);
  }

  @Post(':id/send-back')
  @RequirePermission('payroll.approve')
  sendBack(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReturnRunDto) {
    return this.payroll.sendBack(auth, id, dto.note);
  }

  @Post(':id/finalize')
  @RequirePermission('payroll.approve')
  finalize(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.finalize(auth, id);
  }
}

/** Payslips: your own, and any in a company you read payroll for */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payslips')
@RequirePermission('self.service', 'payroll.read')
export class PayslipsController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('me')
  mine(@Auth() auth: AuthContext) {
    return this.payroll.mine(auth);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.payroll.payslip(auth, id);
  }
}
