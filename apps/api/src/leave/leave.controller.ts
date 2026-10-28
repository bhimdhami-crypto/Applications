import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { UploadedFileLike } from '../profiles/profiles.service';
import { CalendarQuery, CreateAdjustmentDto, CreateHolidayDto, CreateLeaveDto, DecideLeaveDto, HolidayQuery, LeaveListQuery, LeavePreviewQuery } from './leave.dto';
import { LeaveService } from './leave.service';

const MAX_UPLOAD = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };
const thisYear = () => new Date().getUTCFullYear();

@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  types() {
    return this.leave.types();
  }

  @Get('preview')
  preview(@CurrentUser() user: AuthUser, @Query() q: LeavePreviewQuery) {
    return this.leave.preview(user, q.startDate, q.endDate, q.employeeId);
  }

  @Get('balances')
  balances(@CurrentUser() user: AuthUser, @Query() q: LeaveListQuery) {
    return this.leave.balances(user, q.employeeId, q.year ?? thisYear());
  }

  @Get('requests')
  list(@CurrentUser() user: AuthUser, @Query() q: LeaveListQuery) {
    return this.leave.list(user, q.employeeId, q.year ?? thisYear());
  }

  @Post('requests')
  @UseInterceptors(FileInterceptor('file', MAX_UPLOAD))
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeaveDto, @UploadedFile() file?: UploadedFileLike) {
    return this.leave.create(user, dto, file);
  }

  @Post('requests/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.leave.decide(user, id, true, dto.note);
  }

  @Post('requests/:id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.leave.decide(user, id, false, dto.note);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leave.cancel(user, id);
  }

  @Get('approvals')
  approvals(@CurrentUser() user: AuthUser) {
    return this.leave.approvals(user);
  }

  @Get('calendar')
  calendar(@CurrentUser() user: AuthUser, @Query() q: CalendarQuery) {
    return this.leave.calendar(user, q.month, q.companyId);
  }

  @Post('adjustments')
  @Roles(Role.HR)
  adjust(@CurrentUser() user: AuthUser, @Body() dto: CreateAdjustmentDto) {
    return this.leave.addAdjustment(user, dto);
  }

  @Get('holidays')
  holidays(@Query() q: HolidayQuery) {
    return this.leave.holidays(q.countryCode, q.year);
  }

  @Post('holidays')
  @Roles(Role.HR)
  addHoliday(@CurrentUser() user: AuthUser, @Body() dto: CreateHolidayDto) {
    return this.leave.addHoliday(user, dto);
  }

  @Delete('holidays/:id')
  @Roles(Role.HR)
  removeHoliday(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.leave.removeHoliday(user, id);
  }
}
