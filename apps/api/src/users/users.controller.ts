import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthContext } from '../access/auth-context';
import { Auth, RequirePermission } from '../access/decorators';
import { CreateUserDto, GrantDto, UpdateUserDto, UserListQuery } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users.read')
  list(@Auth() auth: AuthContext, @Query() q: UserListQuery) {
    return this.users.list(auth, q);
  }

  @Get(':id')
  @RequirePermission('users.read')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.users.getPresented(auth, id);
  }

  /** Creates the account and emails an invitation to set a password */
  @Post()
  @RequirePermission('users.manage')
  create(@Auth() auth: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.create(auth, dto);
  }

  @Patch(':id')
  @RequirePermission('users.manage')
  update(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(auth, id, dto);
  }

  @Post(':id/roles')
  @RequirePermission('users.manage')
  grant(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: GrantDto) {
    return this.users.grant(auth, id, dto);
  }

  @Delete(':id/roles/:assignmentId')
  @RequirePermission('users.manage')
  revoke(@Auth() auth: AuthContext, @Param('id') id: string, @Param('assignmentId') assignmentId: string) {
    return this.users.revoke(auth, id, assignmentId);
  }

  @Post(':id/resend-invite')
  @RequirePermission('users.manage')
  @HttpCode(204)
  resend(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.users.resendInvite(auth, id);
  }

  @Post(':id/unlock')
  @RequirePermission('users.manage')
  @HttpCode(204)
  unlock(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.users.unlock(auth, id);
  }
}
