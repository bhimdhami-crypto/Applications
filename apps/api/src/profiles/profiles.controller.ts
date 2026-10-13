import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { DOCUMENT_TYPES, ReplaceNextOfKinDto, UpdateDocumentDto, UpdatePersonalDto, UploadDocumentDto } from './profiles.dto';
import { ProfilesService, UploadedFileLike } from './profiles.service';

const MAX_UPLOAD = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };

@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('employees/:id/profile')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.get(user, id);
  }

  @Patch('employees/:id/personal')
  updatePersonal(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePersonalDto) {
    return this.profiles.updatePersonal(user, id, dto);
  }

  @Put('employees/:id/next-of-kin')
  replaceNextOfKin(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplaceNextOfKinDto) {
    return this.profiles.replaceNextOfKin(user, id, dto);
  }

  @Get('employees/:id/photo')
  async photo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { data, mime } = await this.profiles.photo(user, id);
    res.set({
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // Imported avatars are SVG: never let one run scripts if opened directly
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(data);
  }

  @Put('employees/:id/photo')
  @UseInterceptors(FileInterceptor('file', MAX_UPLOAD))
  setPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file?: UploadedFileLike) {
    return this.profiles.setPhoto(user, id, file);
  }

  @Get('document-types')
  documentTypes() {
    return DOCUMENT_TYPES;
  }

  @Get('employees/:id/documents')
  documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.profiles.listDocuments(user, id);
  }

  @Post('employees/:id/documents')
  @UseInterceptors(FileInterceptor('file', MAX_UPLOAD))
  upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UploadDocumentDto, @UploadedFile() file?: UploadedFileLike) {
    return this.profiles.uploadDocument(user, id, dto, file);
  }

  @Get('documents/:docId/file')
  async file(@CurrentUser() user: AuthUser, @Param('docId') docId: string, @Res({ passthrough: true }) res: Response) {
    const { data, mime, fileName } = await this.profiles.documentFile(user, docId);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Patch('documents/:docId')
  @Roles(Role.HR)
  setStatus(@CurrentUser() user: AuthUser, @Param('docId') docId: string, @Body() dto: UpdateDocumentDto) {
    return this.profiles.setDocumentStatus(user, docId, dto.status);
  }

  @Delete('documents/:docId')
  @Roles(Role.HR)
  remove(@CurrentUser() user: AuthUser, @Param('docId') docId: string) {
    return this.profiles.deleteDocument(user, docId);
  }
}
