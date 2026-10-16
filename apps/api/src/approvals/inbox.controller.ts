import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../access/auth-context';
import { Auth } from '../access/decorators';
import { BenefitsService } from '../benefits/benefits.service';
import { DecisionNoteDto } from '../loans/loans.dto';
import { LoansService } from '../loans/loans.service';

const KINDS = ['loan', 'enrolment', 'voucher'] as const;
type Kind = (typeof KINDS)[number];

/** One queue of advances, loans, IOUs, benefit enrolments and gift-voucher nominations waiting for the signed-in person */
@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class InboxController {
  constructor(
    private readonly loans: LoansService,
    private readonly benefits: BenefitsService,
  ) {}

  @Get()
  async list(@Auth() auth: AuthContext) {
    const items = [...(await this.loans.pendingFor(auth)), ...(await this.benefits.pendingFor(auth))];
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  @Post(':kind/:id/approve')
  approve(@Auth() auth: AuthContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: DecisionNoteDto) {
    return this.decide(auth, kind, id, true, dto.note);
  }

  @Post(':kind/:id/decline')
  decline(@Auth() auth: AuthContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: DecisionNoteDto) {
    return this.decide(auth, kind, id, false, dto.note);
  }

  private decide(auth: AuthContext, kind: string, id: string, approve: boolean, note?: string) {
    if (!KINDS.includes(kind as Kind)) throw new BadRequestException('Unknown request type');
    if (kind === 'loan') return this.loans.decide(auth, id, approve, note);
    return this.benefits.decide(auth, kind as 'enrolment' | 'voucher', id, approve, note);
  }
}
