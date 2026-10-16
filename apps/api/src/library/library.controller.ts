import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { UploadedFileLike } from '../people/documents.service';
import { CreateItemDto, LibraryQuery, NewVersionDto, ReportQuery, UpdateItemDto } from './library.dto';
import { LibraryService, MAX_PDF } from './library.service';

const PDF_UPLOAD = { limits: { fileSize: MAX_PDF, files: 1 } };

/** The Policy Centre: group policies to read and confirm, and HR forms to download */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
@RequirePermission('self.service')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query() q: LibraryQuery) {
    return this.library.list(auth, q);
  }

  @Get('pending')
  pending(@Auth() auth: AuthContext) {
    return this.library.pending(auth);
  }

  @Get(':id/file')
  async file(@Auth() auth: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { data, fileName } = await this.library.file(auth, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName.replace(/["\\\r\n]/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Post(':id/acknowledge')
  acknowledge(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.library.acknowledge(auth, id);
  }

  @Post()
  @RequirePermission('policies.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD))
  create(@Auth() auth: AuthContext, @Body() dto: CreateItemDto, @UploadedFile() file?: UploadedFileLike) {
    return this.library.create(auth, dto, file);
  }

  @Post(':id/versions')
  @RequirePermission('policies.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', PDF_UPLOAD))
  newVersion(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: NewVersionDto, @UploadedFile() file?: UploadedFileLike) {
    return this.library.newVersion(auth, id, dto, file);
  }

  @Patch(':id')
  @RequirePermission('policies.manage')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.library.update(auth, id, dto);
  }

  @Get(':id/report')
  @RequirePermission('people.read')
  report(@Auth() auth: AuthContext, @Param('id') id: string, @Query() q: ReportQuery) {
    return this.library.report(auth, id, q.entityId);
  }

  @Post(':id/remind')
  @RequirePermission('people.manage')
  remind(@Auth() auth: AuthContext, @Param('id') id: string, @Query() q: ReportQuery) {
    return this.library.remind(auth, id, q.entityId);
  }
}
