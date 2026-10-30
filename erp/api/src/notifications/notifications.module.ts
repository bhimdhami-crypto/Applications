import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, MailerService],
  exports: [NotificationsService, MailerService],
})
export class NotificationsModule {}
