import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateEmployeeDto, DeleteEmployeeDto, ListEmployeesQuery, UpdateEmployeeDto } from './employees.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListEmployeesQuery) {
    return this.employees.list(user, query);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.employees.me(user);
  }

  @Post()
  @Roles(Role.HR)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(user, dto);
  }

  @Patch(':id')
  @Roles(Role.HR)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(user, id, dto);
  }

  /** Admin only */
  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DeleteEmployeeDto) {
    return this.employees.remove(user, id, dto ?? {});
  }
}
