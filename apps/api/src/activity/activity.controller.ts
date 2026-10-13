import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ClockInDto, EditSessionDto, ReportQuery, TeamQuery, WeekQuery, WorkLogDto } from './activity.dto';
import { ActivityService } from './activity.service';

/** Daily activity tracker (POL-21): clock-in and clock-out, and what people worked on */
@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser, @Query() q: WeekQuery) {
    return this.activity.myWeek(user, q.week);
  }

  @Post('clock-in')
  clockIn(@CurrentUser() user: AuthUser, @Body() dto: ClockInDto) {
    return this.activity.clockIn(user, dto);
  }

  @Post('clock-out')
  clockOut(@CurrentUser() user: AuthUser) {
    return this.activity.clockOut(user);
  }

  @Patch('sessions/:id')
  editSession(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EditSessionDto) {
    return this.activity.editSession(user, id, dto);
  }

  @Post('logs')
  addLog(@CurrentUser() user: AuthUser, @Body() dto: WorkLogDto) {
    return this.activity.addLog(user, dto);
  }

  @Patch('logs/:id')
  editLog(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: WorkLogDto) {
    return this.activity.editLog(user, id, dto);
  }

  @Delete('logs/:id')
  deleteLog(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.activity.deleteLog(user, id);
  }

  @Get('team')
  @Roles(Role.MANAGER, Role.HR, Role.PAYROLL)
  team(@CurrentUser() user: AuthUser, @Query() q: TeamQuery) {
    return this.activity.team(user, q);
  }

  @Get('report')
  @Roles(Role.HR, Role.PAYROLL)
  async report(@CurrentUser() user: AuthUser, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    const result = await this.activity.report(user, q);
    if (typeof result === 'string') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="activity-${q.month}.csv"` });
    }
    return result;
  }
}
