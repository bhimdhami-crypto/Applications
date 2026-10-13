import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BenefitsModule } from './benefits/benefits.module';
import { EmployeesModule } from './employees/employees.module';
import { InboxModule } from './inbox/inbox.module';
import { LeaveModule } from './leave/leave.module';
import { LoansModule } from './loans/loans.module';
import { MailModule } from './mail/mail.module';
import { PayrollModule } from './payroll/payroll.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfilesModule } from './profiles/profiles.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    MailModule,
    StorageModule,
    AuthModule,
    EmployeesModule,
    PayrollModule,
    ProfilesModule,
    LeaveModule,
    LoansModule,
    BenefitsModule,
    InboxModule,
  ],
})
export class AppModule {}
