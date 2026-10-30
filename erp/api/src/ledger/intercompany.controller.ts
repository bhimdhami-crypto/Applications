import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { AsAtQuery, CreateIntercompanyLinkDto } from './ledger.dto';
import { IntercompanyService } from './intercompany.service';

@Controller()
export class IntercompanyController {
  constructor(private readonly intercompany: IntercompanyService) {}

  @Get('companies/:company/intercompany-links')
  links(@Param('company') company: string) {
    return this.intercompany.links(company);
  }

  @Post('companies/:company/intercompany-links')
  @Roles('FINANCE_MANAGER')
  createLink(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: CreateIntercompanyLinkDto) {
    return this.intercompany.createLink(company, user, dto);
  }

  @Get('intercompany/reconciliation')
  reconciliation(@Query() q: AsAtQuery) {
    return this.intercompany.reconciliation(q.to);
  }
}
