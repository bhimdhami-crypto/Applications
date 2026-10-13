import { Module } from '@nestjs/common';
import { BenefitsModule } from '../benefits/benefits.module';
import { LoansModule } from '../loans/loans.module';
import { InboxController } from './inbox.controller';

@Module({
  imports: [LoansModule, BenefitsModule],
  controllers: [InboxController],
})
export class InboxModule {}
