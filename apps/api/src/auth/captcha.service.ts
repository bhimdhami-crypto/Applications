import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Checks the CAPTCHA token from the sign-in page with Cloudflare Turnstile. */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(token: string | undefined, remoteIp?: string): Promise<boolean> {
    if (this.config.get('CAPTCHA_PROVIDER') === 'disabled') return true;
    if (!token) return false;
    const body = new URLSearchParams({ secret: this.config.getOrThrow('TURNSTILE_SECRET'), response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    try {
      const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch (err) {
      this.logger.warn(`CAPTCHA check failed: ${(err as Error).message}`);
      return false;
    }
  }
}
