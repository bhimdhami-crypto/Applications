import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AccessService } from './access.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 16) throw new Error('Set JWT_SECRET to a random string of at least 16 characters');
        return { secret, signOptions: { expiresIn: '15m', issuer: 'gpp-api', audience: 'gpp' }, verifyOptions: { issuer: 'gpp-api', audience: 'gpp' } };
      },
    }),
  ],
  providers: [AccessService],
  exports: [AccessService, JwtModule],
})
export class AccessModule {}
