import { Module } from '@nestjs/common';
import { BenefitsController } from '../benefits/benefits.controller';
import { BenefitsService } from '../benefits/benefits.service';
import { LoansController } from '../loans/loans.controller';
import { LoansService } from '../loans/loans.service';
import { PeopleModule } from '../people/people.module';
import { InboxController } from './inbox.controller';
import { ApprovalNotifier } from './notify.service';

/** Requests that go through several approval steps: advances, loans and IOUs, benefits and gift vouchers, and the shared inbox */
@Module({
  imports: [PeopleModule],
  controllers: [LoansController, BenefitsController, InboxController],
  providers: [ApprovalNotifier, LoansService, BenefitsService],
  exports: [ApprovalNotifier, LoansService, BenefitsService],
})
export class ApprovalsModule {}
