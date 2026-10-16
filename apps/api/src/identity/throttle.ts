import { UseGuards, applyDecorators } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Rate limits per client address. Turned off with THROTTLE=off for the test suite. */
export const ThrottleGuardUse = () => (process.env.THROTTLE === 'off' ? applyDecorators() : applyDecorators(UseGuards(ThrottlerGuard)));
