import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { OrganisationService } from './organisation.service';

class CompanyQuery {
  @IsOptional() @IsString() companyId?: string;
}
class ChartQuery {
  @IsOptional() @IsString() employeeId?: string;
}

@Controller('organisation')
export class OrganisationController {
  constructor(private readonly org: OrganisationService) {}

  @Get('entities')
  entities() {
    return this.org.entities();
  }

  @Get('departments')
  departments(@CurrentUser() user: AuthUser, @Query() query: CompanyQuery) {
    return this.org.departments(user, query.companyId || undefined);
  }

  @Get('chart')
  chart(@CurrentUser() user: AuthUser, @Query() query: ChartQuery) {
    return this.org.chart(user, query.employeeId || undefined);
  }
}
