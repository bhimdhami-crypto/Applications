import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { AddMembersDto, MessagesQuery, PeopleQuery, SendMessageDto, StartChatDto } from './chat.dto';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('people')
  people(@CurrentUser() user: AuthUser, @Query() q: PeopleQuery) {
    return this.chat.people(user, q.q);
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.chat.unread(user);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: AuthUser) {
    return this.chat.conversations(user);
  }

  @Post('conversations')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartChatDto) {
    return this.chat.start(user, dto);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: MessagesQuery) {
    return this.chat.messages(user, id, q);
  }

  @Post('conversations/:id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(user, id, dto);
  }

  @Post('conversations/:id/members')
  addMembers(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.chat.addMembers(user, id, dto);
  }

  @Post('conversations/:id/leave')
  leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.leave(user, id);
  }

  @Delete('messages/:id')
  deleteMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.deleteMessage(user, id);
  }
}
