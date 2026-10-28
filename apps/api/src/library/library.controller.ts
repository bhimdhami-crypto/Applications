import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { UploadedFileLike } from '../profiles/profiles.service';
import { CreateItemDto, LibraryQuery, NewVersionDto, ReportQuery, UpdateItemDto } from './library.dto';
import { LibraryService } from './library.service';

const PDF_UPLOAD = { limits: { fileSize: 20 * 1024 * 1024, files: 1 } };

/** The Policy Centre: group policies to read and confirm, and HR forms to download */
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: LibraryQuery) {
    return this.library.list(user, q);
  }

  @Get('pending')
  pending(@CurrentUser() user: AuthUser) {
    return this.library.pending(user);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { data, fileName } = await this.library.file(user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Post(':id/acknowledge')
  acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.library.acknowledge(user, id);
  }

  @Post()
  @Roles(Role.HR)
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD))
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateItemDto, @UploadedFile() file?: UploadedFileLike) {
    return this.library.create(user, dto, file);
  }

  @Post(':id/versions')
  @Roles(Role.HR)
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD))
  newVersion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: NewVersionDto, @UploadedFile() file?: UploadedFileLike) {
    return this.library.newVersion(user, id, dto, file);
  }

  @Patch(':id')
  @Roles(Role.HR)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.library.update(user, id, dto);
  }

  @Get(':id/report')
  @Roles(Role.HR)
  report(@Param('id') id: string, @Query() q: ReportQuery) {
    return this.library.report(id, q.companyId);
  }

  @Post(':id/remind')
  @Roles(Role.HR)
  remind(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: ReportQuery) {
    return this.library.remind(user, id, q.companyId);
  }
}
