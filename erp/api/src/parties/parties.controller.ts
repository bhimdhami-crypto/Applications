import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreatePartyDto, PartyListQuery, UpdatePartyDto } from './parties.dto';
import { PartiesService } from './parties.service';

@Controller('companies/:company/parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  list(@Param('company') company: string, @Query() q: PartyListQuery) {
    return this.parties.list(company, q.kind);
  }

  @Post()
  @Roles('FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Param('company') company: string, @CurrentUser() user: AuthUser, @Body() dto: CreatePartyDto) {
    return this.parties.create(company, user, dto);
  }

  @Patch(':id')
  @Roles('FINANCE_MANAGER')
  update(
    @Param('company') company: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.parties.update(company, id, user, dto);
  }
}
