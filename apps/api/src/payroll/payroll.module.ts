import { Module } from '@nestjs/common';
import { CompaniesController } from '../companies/companies.controller';
import { PayrollController } from './payroll.controller';
import { PayrollScheduler } from './payroll.scheduler';
import { PayrollService } from './payroll.service';

@Module({
  controllers: [PayrollController, CompaniesController],
  providers: [PayrollService, PayrollScheduler],
  exports: [PayrollService],
})
export class PayrollModule {}
