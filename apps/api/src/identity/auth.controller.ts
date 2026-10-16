import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthContext } from '../access/auth-context';
import { Auth, Public } from '../access/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInviteDto, ChangePasswordDto, LoginDto, RefreshDto, VerifyDto } from './auth.dto';
import { AuthService, IssuedTokens } from './auth.service';
import { ThrottleGuardUse } from './throttle';

const COOKIE = 'gpp_rt';
const COOKIE_PATH = '/api/auth';

function readCookie(req: Request, name: string) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('auth')
@Controller('auth')
@ThrottleGuardUse()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private respond(res: Response, tokens: IssuedTokens, client: 'web' | 'mobile') {
    const body = { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, sessionId: tokens.sessionId };
    if (client === 'mobile') return { ...body, refreshToken: tokens.refreshToken };
    res.cookie(COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      path: COOKIE_PATH,
      maxAge: 12 * 3600_000,
    });
    return body;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const client = dto.client ?? 'web';
    return this.respond(res, await this.auth.verify(dto.challengeId, dto.code, client, meta(req)), client);
  }

  /** Mobile sends the refresh token in the body; the web portal's arrives in its cookie */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const fromBody = dto.refreshToken;
    const token = fromBody ?? readCookie(req, COOKIE);
    if (!token) throw new UnauthorizedException('Sign in first');
    return this.respond(res, await this.auth.refresh(token, meta(req)), fromBody ? 'mobile' : 'web');
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(dto.refreshToken ?? readCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept-invite')
  @HttpCode(200)
  acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: Request) {
    return this.auth.acceptInvite(dto.token, dto.password, meta(req));
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@Auth() auth: AuthContext, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(auth.userId, auth.sessionId, dto.currentPassword, dto.newPassword);
  }

  /** The caller's signed-in devices */
  @ApiBearerAuth()
  @Get('sessions')
  async sessions(@Auth() auth: AuthContext) {
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, client: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return rows.map((s) => ({ ...s, current: s.id === auth.sessionId }));
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@Auth() auth: AuthContext, @Param('id') id: string) {
    const s = await this.prisma.session.findUnique({ where: { id } });
    if (!s || s.userId !== auth.userId) throw new NotFoundException('Session not found');
    await this.auth.revokeSession(id, 'signed out from another device');
  }
}
