import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { LoginDto } from './auth.dto';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
