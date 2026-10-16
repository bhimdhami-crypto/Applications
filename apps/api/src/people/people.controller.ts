import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { ChangeRequestsService } from './change-requests.service';
import { DocumentsService, MAX_UPLOAD_BYTES, UploadedFileLike } from './documents.service';
import {
  BankChangeDto,
  ChangeRequestQuery,
  CreateEmployeeDto,
  DecisionDto,
  DOCUMENT_TYPES,
  EmployeeListQuery,
  HeadcountQuery,
  NewAssignmentDto,
  NewCompensationDto,
  ReplaceContactsDto,
  TerminateDto,
  UpdateDocumentDto,
  UpdateEmploymentDto,
  UpdatePersonalDto,
  UploadDocumentDto,
} from './people.dto';
import { PeopleService } from './people.service';

const UPLOAD = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };

/**
 * Employee records. Every route re-checks the caller's relation to the record (HR for the
 * company, the employee themself, or someone above them in the reporting line), so a record
 * outside that answers 404.
 */
@ApiTags('people')
@ApiBearerAuth()
@Controller()
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly documents: DocumentsService,
    private readonly changes: ChangeRequestsService,
  ) {}

  @Get('employees')
  @RequirePermission('people.read')
  list(@Auth() auth: AuthContext, @Query() q: EmployeeListQuery) {
    return this.people.list(auth, q);
  }

  @Get('employees/team')
  @RequirePermission('team.read')
  team(@Auth() auth: AuthContext) {
    return this.people.team(auth);
  }

  @Get('employees/mine')
  @RequirePermission('self.service')
  mine(@Auth() auth: AuthContext) {
    return this.people.mine(auth);
  }

  @Get('employees/headcount')
  @RequirePermission('people.read')
  headcount(@Auth() auth: AuthContext, @Query() q: HeadcountQuery) {
    return this.people.headcount(auth, q);
  }

  @Post('employees')
  @RequirePermission('people.manage')
  create(@Auth() auth: AuthContext, @Body() dto: CreateEmployeeDto) {
    return this.people.create(auth, dto);
  }

  @Get('job-grades')
  grades(@Auth() auth: AuthContext) {
    return this.people.grades(auth);
  }

  @Get('document-types')
  documentTypes() {
    return DOCUMENT_TYPES;
  }

  @Get('employees/:id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.people.get(auth, id);
  }

  @Get('employees/:id/history')
  history(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.people.history(auth, id);
  }

  @Get('employees/:id/pay')
  pay(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.people.pay(auth, id);
  }

  /** Full identity number, audited */
  @Post('employees/:id/identifiers/:itemId/reveal')
  @HttpCode(200)
  revealIdentifier(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.people.reveal(auth, id, 'identifier', itemId);
  }

  /** Full bank account number, audited */
  @Post('employees/:id/bank-accounts/:itemId/reveal')
  @HttpCode(200)
  revealBank(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.people.reveal(auth, id, 'bank', itemId);
  }

  @Patch('employees/:id/personal')
  updatePersonal(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdatePersonalDto) {
    return this.people.updatePersonal(auth, id, dto);
  }

  @Put('employees/:id/contacts')
  replaceContacts(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ReplaceContactsDto) {
    return this.people.replaceContacts(auth, id, dto);
  }

  @Patch('employees/:id/employment')
  @RequirePermission('people.manage')
  updateEmployment(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateEmploymentDto) {
    return this.people.updateEmployment(auth, id, dto);
  }

  @Post('employees/:id/assignments')
  @RequirePermission('people.manage')
  addAssignment(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: NewAssignmentDto) {
    return this.people.addAssignment(auth, id, dto);
  }

  @Post('employees/:id/compensation')
  @RequirePermission('people.manage')
  addCompensation(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: NewCompensationDto) {
    return this.people.addCompensation(auth, id, dto);
  }

  @Post('employees/:id/terminate')
  @HttpCode(200)
  @RequirePermission('people.manage')
  terminate(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: TerminateDto) {
    return this.people.terminate(auth, id, dto);
  }

  // ───── Photo ─────

  @Get('employees/:id/photo')
  async photo(@Auth() auth: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { photoKey, svg } = await this.people.photo(auth, id);
    const uploaded = photoKey ? await this.documents.photoFile(photoKey) : null;
    res.set({
      'Content-Type': uploaded?.mime ?? 'image/svg+xml',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // The drawn avatar is SVG: never let it run anything if opened directly
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(uploaded?.data ?? Buffer.from(svg));
  }

  @Put('employees/:id/photo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  setPhoto(@Auth() auth: AuthContext, @Param('id') id: string, @UploadedFile() file?: UploadedFileLike) {
    return this.documents.setPhoto(auth, id, file);
  }

  @Delete('employees/:id/photo')
  removePhoto(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.documents.removePhoto(auth, id);
  }

  // ───── Documents ─────

  @Get('employees/:id/documents')
  listDocuments(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.documents.list(auth, id);
  }

  @Post('employees/:id/documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD))
  upload(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UploadDocumentDto, @UploadedFile() file?: UploadedFileLike) {
    return this.documents.upload(auth, id, dto, file);
  }

  @Get('documents/:docId/file')
  async file(@Auth() auth: AuthContext, @Param('docId') docId: string, @Res({ passthrough: true }) res: Response) {
    const { data, mime, fileName } = await this.documents.file(auth, docId);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data);
  }

  @Patch('documents/:docId')
  @RequirePermission('people.manage')
  setDocumentStatus(@Auth() auth: AuthContext, @Param('docId') docId: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.setStatus(auth, docId, dto.status);
  }

  @Delete('documents/:docId')
  @HttpCode(204)
  @RequirePermission('people.manage')
  removeDocument(@Auth() auth: AuthContext, @Param('docId') docId: string) {
    return this.documents.remove(auth, docId);
  }

  // ───── Changes that need approval ─────

  @Post('employees/:id/bank-change')
  requestBankChange(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: BankChangeDto) {
    return this.changes.requestBankChange(auth, id, dto);
  }

  @Get('employees/:id/change-requests')
  employeeRequests(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.changes.forEmployee(auth, id);
  }

  @Get('change-requests')
  @RequirePermission('people.manage')
  listRequests(@Auth() auth: AuthContext, @Query() q: ChangeRequestQuery) {
    return this.changes.list(auth, q);
  }

  @Get('change-requests/:id')
  @RequirePermission('people.manage')
  requestDetails(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.changes.details(auth, id);
  }

  @Post('change-requests/:id/approve')
  @HttpCode(200)
  @RequirePermission('people.manage')
  approve(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.changes.decide(auth, id, true, dto);
  }

  @Post('change-requests/:id/reject')
  @HttpCode(200)
  @RequirePermission('people.manage')
  reject(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.changes.decide(auth, id, false, dto);
  }

  @Post('change-requests/:id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.changes.cancel(auth, id);
  }
}
