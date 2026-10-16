import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LeaveModule } from '../leave/leave.module';
import { PayrollController, PayslipsController } from './payroll.controller';
import { PayrollService } from './payroll.service';

/** Month-end payroll and payslips */
@Module({
  imports: [LeaveModule, ApprovalsModule],
  controllers: [PayrollController, PayslipsController],
  providers: [PayrollService],
})
export class PayrollModule {}
