import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from './approvals/approvals.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { PartiesModule } from './parties/parties.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { VouchersModule } from './vouchers/vouchers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    CompaniesModule,
    LedgerModule,
    VouchersModule,
    PartiesModule,
    ReportsModule,
    ApprovalsModule,
  ],
})
export class AppModule {}
