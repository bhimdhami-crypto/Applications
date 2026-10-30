import { Module } from '@nestjs/common';
import { ArchiveService } from '../archive/archive.service';
import { LedgerModule } from '../ledger/ledger.module';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  imports: [LedgerModule],
  controllers: [VouchersController],
  providers: [VouchersService, ArchiveService],
  exports: [VouchersService],
})
export class VouchersModule {}
