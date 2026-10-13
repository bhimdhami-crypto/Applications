import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [ApprovalsModule, ProfilesModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
