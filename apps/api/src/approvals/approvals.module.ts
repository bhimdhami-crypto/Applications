import { Module } from '@nestjs/common';
import { LoansController } from '../loans/loans.controller';
import { LoansService } from '../loans/loans.service';
import { PeopleModule } from '../people/people.module';
import { InboxController } from './inbox.controller';
import { ApprovalNotifier } from './notify.service';

/** Requests that go through several approval steps: advances, loans and IOUs, and the shared inbox */
@Module({
  imports: [PeopleModule],
  controllers: [LoansController, InboxController],
  providers: [ApprovalNotifier, LoansService],
  exports: [ApprovalNotifier, LoansService],
})
export class ApprovalsModule {}
