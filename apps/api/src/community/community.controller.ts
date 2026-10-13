import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { UploadedFileLike } from '../profiles/profiles.service';
import { CommentDto, CreatePostDto, FeedQuery, ReportDto, ReportsQuery, ReviewDto } from './community.dto';
import { CommunityService, MAX_FILES } from './community.service';

@Controller()
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('community/posts')
  feed(@CurrentUser() user: AuthUser, @Query() q: FeedQuery) {
    return this.community.feed(user, q.before);
  }

  @Post('community/posts')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES, { limits: { fileSize: 50 * 1024 * 1024, files: MAX_FILES } }))
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto, @UploadedFiles() files?: UploadedFileLike[]) {
    return this.community.create(user, dto, files);
  }

  @Get('community/posts/:id/files/:index')
  async file(@Param('id') id: string, @Param('index', ParseIntPipe) index: number, @Res({ passthrough: true }) res: Response) {
    const { data, mime, name } = await this.community.file(id, index);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${name.replace(/["\r\n]/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Post('community/posts/:id/like')
  like(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.community.like(user, id, true);
  }

  @Delete('community/posts/:id/like')
  unlike(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.community.like(user, id, false);
  }

  @Post('community/posts/:id/comments')
  comment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.community.comment(user, id, dto);
  }

  @Delete('community/posts/:id')
  removePost(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.community.removePost(user, id);
  }

  @Delete('community/comments/:id')
  removeComment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.community.removeComment(user, id);
  }

  @Post('reports')
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportDto) {
    return this.community.report(user, dto);
  }

  @Get('reports')
  @Roles(Role.HR)
  reports(@Query() q: ReportsQuery) {
    return this.community.reports(q.status);
  }

  @Get('reports/open')
  @Roles(Role.HR)
  openReports() {
    return this.community.openReports();
  }

  @Post('reports/:id/remove')
  @Roles(Role.HR)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.community.review(user, id, true, dto);
  }

  @Post('reports/:id/dismiss')
  @Roles(Role.HR)
  dismiss(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.community.review(user, id, false, dto);
  }
}
