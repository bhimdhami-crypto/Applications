import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { CompaniesController } from '../companies/companies.controller';
import { PayrollController } from './payroll.controller';
import { PayrollScheduler } from './payroll.scheduler';
import { PayrollService } from './payroll.service';

@Module({
  imports: [LeaveModule],
  controllers: [PayrollController, CompaniesController],
  providers: [PayrollService, PayrollScheduler],
  exports: [PayrollService],
})
export class PayrollModule {}
