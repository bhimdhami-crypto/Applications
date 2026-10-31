import { Controller, Get, Param, ParseEnumPipe, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { HISTORY_ENTITIES, HistoryEntity, HistoryQuery, SignInQuery } from './history.dto';
import { HistoryService } from './history.service';

const ENTITY_ENUM = Object.fromEntries(HISTORY_ENTITIES.map((e) => [e, e]));

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  /** The whole company's trail is for those who answer for controls; a record's own history is open to anyone who can see it */
  @Get('companies/:company/history')
  @Roles('ADMIN', 'DIRECTOR', 'FINANCE_MANAGER')
  list(@Param('company') company: string, @Query() q: HistoryQuery) {
    return this.history.list(company, q);
  }

  @Get('companies/:company/history/people')
  @Roles('ADMIN', 'DIRECTOR', 'FINANCE_MANAGER')
  people(@Param('company') company: string) {
    return this.history.people(company);
  }

  @Get('companies/:company/history/:entity/:id')
  forRecord(
    @Param('company') company: string,
    @Param('entity', new ParseEnumPipe(ENTITY_ENUM)) entity: HistoryEntity,
    @Param('id') id: string,
  ) {
    return this.history.forRecord(company, entity, id.slice(0, 50));
  }

  @Get('sign-ins')
  @Roles('ADMIN')
  signIns(@Query() q: SignInQuery) {
    return this.history.signIns(q);
  }
}
