import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateCandidateDto, CreateOpeningDto, HireCandidateDto, MoveCandidateDto, OpeningQuery, UpdateOpeningDto } from './recruitment.dto';
import { RecruitmentService } from './recruitment.service';

@Controller('recruitment')
@Roles(Role.HR, Role.MANAGER)
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get('openings')
  list(@CurrentUser() user: AuthUser, @Query() query: OpeningQuery) {
    return this.recruitment.listOpenings(user, query);
  }

  @Get('openings/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recruitment.getOpening(user, id);
  }

  @Post('openings')
  @Roles(Role.HR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOpeningDto) {
    return this.recruitment.createOpening(user, dto);
  }

  @Patch('openings/:id')
  @Roles(Role.HR)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOpeningDto) {
    return this.recruitment.updateOpening(user, id, dto);
  }

  @Post('openings/:id/candidates')
  addCandidate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateCandidateDto) {
    return this.recruitment.addCandidate(user, id, dto);
  }

  @Patch('candidates/:id')
  move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MoveCandidateDto) {
    return this.recruitment.moveCandidate(user, id, dto);
  }

  @Post('candidates/:id/hire')
  @Roles(Role.HR)
  hire(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: HireCandidateDto) {
    return this.recruitment.hire(user, id, dto);
  }
}
