import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [LeaveModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
