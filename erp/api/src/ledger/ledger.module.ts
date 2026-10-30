import { Module } from '@nestjs/common';
import { IntercompanyController } from './intercompany.controller';
import { IntercompanyService } from './intercompany.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  controllers: [LedgerController, IntercompanyController],
  providers: [LedgerService, IntercompanyService],
  exports: [LedgerService],
})
export class LedgerModule {}
