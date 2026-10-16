import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import {
  CreateBranchDto,
  CreateBusinessUnitDto,
  CreateCostCentreDto,
  CreateCountryDto,
  CreateCurrencyDto,
  CreateDepartmentDto,
  CreateEntityDto,
  EntityListQuery,
  SetFeatureDto,
  StructureKindParam,
  UpdateCountryDto,
  UpdateCurrencyDto,
  UpdateEntityDto,
  UpdateStructureDto,
} from './org.dto';
import { OrgService } from './org.service';

@ApiTags('organisation')
@ApiBearerAuth()
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('currencies')
  currencies() {
    return this.org.currencies();
  }

  @Post('currencies')
  @RequirePermission('geo.manage')
  createCurrency(@Auth() auth: AuthContext, @Body() dto: CreateCurrencyDto) {
    return this.org.createCurrency(auth, dto);
  }

  @Patch('currencies/:code')
  @RequirePermission('geo.manage')
  updateCurrency(@Auth() auth: AuthContext, @Param('code') code: string, @Body() dto: UpdateCurrencyDto) {
    return this.org.updateCurrency(auth, code, dto);
  }

  @Get('languages')
  languages() {
    return this.org.languages();
  }

  @Get('countries')
  @RequirePermission('org.read')
  countries(@Auth() auth: AuthContext) {
    return this.org.countries(auth);
  }

  @Post('countries')
  @RequirePermission('geo.manage')
  createCountry(@Auth() auth: AuthContext, @Body() dto: CreateCountryDto) {
    return this.org.createCountry(auth, dto);
  }

  @Patch('countries/:code')
  @RequirePermission('geo.manage')
  updateCountry(@Auth() auth: AuthContext, @Param('code') code: string, @Body() dto: UpdateCountryDto) {
    return this.org.updateCountry(auth, code, dto);
  }

  /** Group → country → company → business units, branches, departments and cost centres, limited to the caller's scope */
  @Get('tree')
  @RequirePermission('org.read')
  tree(@Auth() auth: AuthContext) {
    return this.org.tree(auth);
  }

  @Get('entities')
  @RequirePermission('org.read')
  entities(@Auth() auth: AuthContext, @Query() q: EntityListQuery) {
    return this.org.entities(auth, q.countryCode, q.q);
  }

  @Get('entities/:id')
  @RequirePermission('org.read')
  entity(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.org.entity(auth, id);
  }

  @Post('entities')
  @RequirePermission('org.entities.manage')
  createEntity(@Auth() auth: AuthContext, @Body() dto: CreateEntityDto) {
    return this.org.createEntity(auth, dto);
  }

  @Patch('entities/:id')
  @RequirePermission('org.entities.manage')
  updateEntity(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateEntityDto) {
    return this.org.updateEntity(auth, id, dto);
  }

  @Put('entities/:id/features/:module')
  @RequirePermission('features.manage')
  setFeature(@Auth() auth: AuthContext, @Param('id') id: string, @Param('module') module: string, @Body() dto: SetFeatureDto) {
    return this.org.setFeature(auth, id, module, dto.enabled);
  }

  @Post('entities/:id/business-units')
  @RequirePermission('org.structure.manage')
  createBusinessUnit(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: CreateBusinessUnitDto) {
    return this.org.createStructure(auth, id, 'business-units', dto);
  }

  @Post('entities/:id/branches')
  @RequirePermission('org.structure.manage')
  createBranch(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: CreateBranchDto) {
    return this.org.createStructure(auth, id, 'branches', dto);
  }

  @Post('entities/:id/departments')
  @RequirePermission('org.structure.manage')
  createDepartment(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: CreateDepartmentDto) {
    return this.org.createStructure(auth, id, 'departments', dto);
  }

  @Post('entities/:id/cost-centres')
  @RequirePermission('org.structure.manage')
  createCostCentre(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: CreateCostCentreDto) {
    return this.org.createStructure(auth, id, 'cost-centres', dto);
  }

  @Patch(':kind/:id')
  @RequirePermission('org.structure.manage')
  updateStructure(@Auth() auth: AuthContext, @Param() p: StructureKindParam, @Body() dto: UpdateStructureDto) {
    return this.org.updateStructure(auth, p.kind, p.id, dto);
  }
}
