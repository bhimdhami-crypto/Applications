import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateCycleDto, CreateGoalDto, CycleQuery, GoalQuery, SubmitReviewDto, UpdateGoalDto } from './performance.dto';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('cycles')
  cycles(@CurrentUser() user: AuthUser, @Query() query: CycleQuery) {
    return this.performance.cycles(user, query.companyId || undefined);
  }

  @Post('cycles')
  @Roles(Role.HR)
  createCycle(@CurrentUser() user: AuthUser, @Body() dto: CreateCycleDto) {
    return this.performance.createCycle(user, dto);
  }

  @Post('cycles/:id/close')
  @Roles(Role.HR)
  closeCycle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.performance.closeCycle(user, id);
  }

  @Get('cycles/:id/reviews')
  @Roles(Role.HR, Role.MANAGER)
  cycleReviews(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.performance.cycleReviews(user, id);
  }

  @Get('reviews/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.performance.mine(user);
  }

  @Post('reviews/:id/self')
  submitSelf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitReviewDto) {
    return this.performance.submitSelf(user, id, dto);
  }

  @Post('reviews/:id/manager')
  submitManager(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitReviewDto) {
    return this.performance.submitManager(user, id, dto);
  }

  @Get('goals')
  goals(@CurrentUser() user: AuthUser, @Query() query: GoalQuery) {
    return this.performance.goals(user, query.employeeId || undefined);
  }

  @Post('goals')
  createGoal(@CurrentUser() user: AuthUser, @Body() dto: CreateGoalDto) {
    return this.performance.createGoal(user, dto);
  }

  @Patch('goals/:id')
  updateGoal(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateGoalDto) {
    return this.performance.updateGoal(user, id, dto);
  }

  @Delete('goals/:id')
  deleteGoal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.performance.deleteGoal(user, id);
  }
}
