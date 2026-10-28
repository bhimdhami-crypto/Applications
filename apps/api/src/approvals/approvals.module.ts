import { Module } from '@nestjs/common';
import { ApprovalNotifier } from './notify.service';

@Module({
  providers: [ApprovalNotifier],
  exports: [ApprovalNotifier],
})
export class ApprovalsModule {}
