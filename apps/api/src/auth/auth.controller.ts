import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, VerifyDto } from './auth.dto';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from './decorators';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, dto.captchaToken, req.ip);
  }

  @Public()
  @Get('demo')
  demo() {
    return this.auth.demo();
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyDto) {
    return this.auth.verify(dto.challengeId, dto.code);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      include: { company: true },
    });
    if (!employee) return { ...user, employee: null };
    // The storage key stays server side; the client only needs to know a photo exists
    const { photoKey, ...rest } = employee;
    return { ...user, employee: { ...rest, hasPhoto: !!photoKey } };
  }
}
