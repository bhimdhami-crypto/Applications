import { Module } from '@nestjs/common';
import { VouchersModule } from '../vouchers/vouchers.module';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';

@Module({
  imports: [VouchersModule],
  controllers: [BankController],
  providers: [BankService],
})
export class BankModule {}
