import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { MAX_UPLOAD_BYTES, UploadedFileLike } from '../people/documents.service';
import { CalendarQuery, CreateAdjustmentDto, CreateHolidayDto, CreateLeaveDto, DecideLeaveDto, HolidayQuery, LeaveListQuery, LeavePreviewQuery } from './leave.dto';
import { LeaveService } from './leave.service';

const UPLOAD = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };
const thisYear = () => new Date().getUTCFullYear();

/**
 * Leave and absence. Everyone with self-service can ask for leave; who may read or decide a
 * request is checked against the employee record in the service (self, line manager, or HR).
 */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
@RequirePermission('self.service')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  types() {
    return this.leave.types();
  }

  @Get('preview')
  preview(@Auth() auth: AuthContext, @Query() q: LeavePreviewQuery) {
    return this.leave.preview(auth, q.startDate, q.endDate, q.employmentId);
  }

  @Get('balances')
  balances(@Auth() auth: AuthContext, @Query() q: LeaveListQuery) {
    return this.leave.balances(auth, q.employmentId, q.year ?? thisYear());
  }

  @Get('requests')
  list(@Auth() auth: AuthContext, @Query() q: LeaveListQuery) {
    return this.leave.list(auth, q.employmentId, q.year ?? thisYear());
  }

  @Post('requests')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  create(@Auth() auth: AuthContext, @Body() dto: CreateLeaveDto, @UploadedFile() file?: UploadedFileLike) {
    return this.leave.create(auth, dto, file);
  }

  @Post('requests/:id/approve')
  approve(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.leave.decide(auth, id, true, dto.note);
  }

  @Post('requests/:id/decline')
  decline(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.leave.decide(auth, id, false, dto.note);
  }

  @Post('requests/:id/cancel')
  cancel(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.leave.cancel(auth, id);
  }

  @Get('approvals')
  approvals(@Auth() auth: AuthContext) {
    return this.leave.approvals(auth);
  }

  @Get('calendar')
  calendar(@Auth() auth: AuthContext, @Query() q: CalendarQuery) {
    return this.leave.calendar(auth, q.month, q.entityId);
  }

  @Post('adjustments')
  @RequirePermission('people.manage')
  adjust(@Auth() auth: AuthContext, @Body() dto: CreateAdjustmentDto) {
    return this.leave.addAdjustment(auth, dto);
  }

  @Get('holidays')
  holidays(@Query() q: HolidayQuery) {
    return this.leave.holidays(q.countryCode, q.year);
  }

  @Post('holidays')
  @RequirePermission('people.manage')
  addHoliday(@Auth() auth: AuthContext, @Body() dto: CreateHolidayDto) {
    return this.leave.addHoliday(auth, dto);
  }

  @Post('holidays/:id/confirm')
  @RequirePermission('people.manage')
  confirmHoliday(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.leave.confirmHoliday(auth, id);
  }

  @Delete('holidays/:id')
  @RequirePermission('people.manage')
  removeHoliday(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.leave.removeHoliday(auth, id);
  }
}
