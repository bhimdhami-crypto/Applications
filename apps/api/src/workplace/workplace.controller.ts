import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { UploadedFileLike } from '../people/documents.service';
import { ActivityReportQuery, ClockInDto, EditSessionDto, TeamQuery, WeekQuery, WorkLogDto } from './activity.dto';
import { ActivityService } from './activity.service';
import { AddMembersDto, MessagesQuery, PeopleQuery, SendMessageDto, StartChatDto } from './chat.dto';
import { ChatService } from './chat.service';
import { CommentDto, CreatePostDto, FeedQuery, ReportDto, ReportsQuery, ReviewDto } from './community.dto';
import { CommunityService, MAX_FILES, MAX_VIDEO } from './community.service';

/** Chat between colleagues anywhere in the group (POL-20) */
@ApiTags('workplace')
@ApiBearerAuth()
@Controller('chat')
@RequirePermission('self.service')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('people')
  people(@Auth() auth: AuthContext, @Query() q: PeopleQuery) {
    return this.chat.people(auth, q.q);
  }

  @Get('unread')
  unread(@Auth() auth: AuthContext) {
    return this.chat.unread(auth);
  }

  @Get('conversations')
  conversations(@Auth() auth: AuthContext) {
    return this.chat.conversations(auth);
  }

  @Post('conversations')
  start(@Auth() auth: AuthContext, @Body() dto: StartChatDto) {
    return this.chat.start(auth, dto);
  }

  @Get('conversations/:id/messages')
  messages(@Auth() auth: AuthContext, @Param('id') id: string, @Query() q: MessagesQuery) {
    return this.chat.messages(auth, id, q);
  }

  @Post('conversations/:id/messages')
  send(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(auth, id, dto);
  }

  @Post('conversations/:id/members')
  addMembers(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.chat.addMembers(auth, id, dto);
  }

  @Post('conversations/:id/leave')
  leave(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.leave(auth, id);
  }

  @Delete('messages/:id')
  deleteMessage(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.chat.deleteMessage(auth, id);
  }
}

/** The community page: posts, likes and comments for everyone in the group (POL-20) */
@ApiTags('workplace')
@ApiBearerAuth()
@Controller('community')
@RequirePermission('self.service')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('posts')
  feed(@Auth() auth: AuthContext, @Query() q: FeedQuery) {
    return this.community.feed(auth, q.before);
  }

  @Post('posts')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_VIDEO, files: MAX_FILES } }))
  create(@Auth() auth: AuthContext, @Body() dto: CreatePostDto, @UploadedFiles() files?: UploadedFileLike[]) {
    return this.community.create(auth, dto, files);
  }

  @Get('posts/:id/files/:index')
  async file(@Auth() auth: AuthContext, @Param('id') id: string, @Param('index', ParseIntPipe) index: number, @Res({ passthrough: true }) res: Response) {
    const { data, mime, name } = await this.community.file(auth, id, index);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${name.replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Post('posts/:id/like')
  like(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.community.like(auth, id, true);
  }

  @Delete('posts/:id/like')
  unlike(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.community.like(auth, id, false);
  }

  @Post('posts/:id/comments')
  comment(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.community.comment(auth, id, dto);
  }

  @Delete('posts/:id')
  removePost(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.community.removePost(auth, id);
  }

  @Delete('comments/:id')
  removeComment(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.community.removeComment(auth, id);
  }

  /** Anyone reports a message, post or comment; HR for the author's company reviews it */
  @Post('reports')
  report(@Auth() auth: AuthContext, @Body() dto: ReportDto) {
    return this.community.report(auth, dto);
  }

  @Get('reports')
  @RequirePermission('people.manage')
  reports(@Auth() auth: AuthContext, @Query() q: ReportsQuery) {
    return this.community.reports(auth, q.status);
  }

  @Get('reports/open')
  @RequirePermission('people.manage')
  openReports(@Auth() auth: AuthContext) {
    return this.community.openReports(auth);
  }

  @Post('reports/:id/remove')
  @RequirePermission('people.manage')
  remove(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.community.review(auth, id, true, dto);
  }

  @Post('reports/:id/dismiss')
  @RequirePermission('people.manage')
  dismiss(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.community.review(auth, id, false, dto);
  }
}

/** The daily activity tracker (POL-21): clock-in and clock-out, and what people worked on */
@ApiTags('workplace')
@ApiBearerAuth()
@Controller('activity')
@RequirePermission('self.service')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('me')
  me(@Auth() auth: AuthContext, @Query() q: WeekQuery) {
    return this.activity.myWeek(auth, q.week);
  }

  @Post('clock-in')
  clockIn(@Auth() auth: AuthContext, @Body() dto: ClockInDto) {
    return this.activity.clockIn(auth, dto);
  }

  @Post('clock-out')
  clockOut(@Auth() auth: AuthContext) {
    return this.activity.clockOut(auth);
  }

  @Patch('sessions/:id')
  editSession(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: EditSessionDto) {
    return this.activity.editSession(auth, id, dto);
  }

  @Post('logs')
  addLog(@Auth() auth: AuthContext, @Body() dto: WorkLogDto) {
    return this.activity.addLog(auth, dto);
  }

  @Patch('logs/:id')
  editLog(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: WorkLogDto) {
    return this.activity.editLog(auth, id, dto);
  }

  @Delete('logs/:id')
  deleteLog(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.activity.deleteLog(auth, id);
  }

  @Get('team')
  @RequirePermission('team.read', 'people.read', 'payroll.read')
  team(@Auth() auth: AuthContext, @Query() q: TeamQuery) {
    return this.activity.team(auth, q);
  }

  @Get('report')
  @RequirePermission('people.read', 'payroll.read')
  async report(@Auth() auth: AuthContext, @Query() q: ActivityReportQuery, @Res({ passthrough: true }) res: Response) {
    const result = await this.activity.report(auth, q);
    if (typeof result === 'string') {
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="activity-${q.month}.csv"` });
    }
    return result;
  }
}
