import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccessGuard } from './access/access.guard';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { HealthController } from './health/health.controller';
import { IdentityModule } from './identity/identity.module';
import { MailModule } from './mail/mail.module';
import { OrgModule } from './org/org.module';
import { PrismaModule } from './prisma/prisma.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { LeaveModule } from './leave/leave.module';
import { LibraryModule } from './library/library.module';
import { PeopleModule } from './people/people.module';
import { UsersModule } from './users/users.module';
import { WorkplaceModule } from './workplace/workplace.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Sign-in endpoints opt in with their own, stricter limits
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    PrismaModule,
    MailModule,
    AuditModule,
    AccessModule,
    IdentityModule,
    OrgModule,
    UsersModule,
    PeopleModule,
    LeaveModule,
    ApprovalsModule,
    LibraryModule,
    WorkplaceModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AccessGuard }],
})
export class AppModule {}
