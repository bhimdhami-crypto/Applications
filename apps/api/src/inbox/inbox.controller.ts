import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { actorInfo } from '../approvals/people';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { BenefitsService } from '../benefits/benefits.service';
import { DecideLeaveDto } from '../leave/leave.dto';
import { LoansService } from '../loans/loans.service';
import { PrismaService } from '../prisma/prisma.service';

const ENTITIES = ['loan', 'enrolment', 'voucher'] as const;
type Entity = (typeof ENTITIES)[number];

/** One queue of loans, advances, IOUs, benefit enrolments and gift vouchers waiting for the signed-in person */
@Controller('approvals')
export class InboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loans: LoansService,
    private readonly benefits: BenefitsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const me = await actorInfo(this.prisma, user);
    const items = [...(await this.loans.pendingFor(user, me.employeeId)), ...(await this.benefits.pendingFor(user, me.employeeId))];
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  @Post(':entity/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('entity') entity: string, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.decide(user, entity, id, true, dto.note);
  }

  @Post(':entity/:id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('entity') entity: string, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.decide(user, entity, id, false, dto.note);
  }

  private decide(user: AuthUser, entity: string, id: string, approve: boolean, note?: string) {
    if (!ENTITIES.includes(entity as Entity)) throw new BadRequestException('Unknown request type');
    if (entity === 'loan') return this.loans.decide(user, id, approve, note);
    return this.benefits.decide(user, entity as 'enrolment' | 'voucher', id, approve, note);
  }
}
