import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { PeopleModule } from '../people/people.module';
import { ActivityService } from './activity.service';
import { ChatService } from './chat.service';
import { CommunityService } from './community.service';
import { ActivityController, ChatController, CommunityController } from './workplace.controller';

/** Chat, the community page with moderation, and the activity tracker */
@Module({
  imports: [PeopleModule, LeaveModule],
  controllers: [ChatController, CommunityController, ActivityController],
  providers: [ChatService, CommunityService, ActivityService],
})
export class WorkplaceModule {}
