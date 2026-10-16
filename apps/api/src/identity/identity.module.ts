import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

@Module({ controllers: [AuthController, MeController], providers: [AuthService], exports: [AuthService] })
export class IdentityModule {}
