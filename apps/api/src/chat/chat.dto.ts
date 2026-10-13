import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class PeopleQuery {
  @IsOptional() @IsString() @MaxLength(80) q?: string;
}

export class StartChatDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) userIds: string[];
  /** A name makes it a group; one person and no name is a direct chat */
  @IsOptional() @trim() @IsString() @Length(2, 80) name?: string;
}

export class SendMessageDto {
  @trim() @IsString() @Length(1, 4000) body: string;
}

export class MessagesQuery {
  /** Messages after this id (polling for new ones) */
  @IsOptional() @IsString() after?: string;
  /** Messages before this id (loading older ones) */
  @IsOptional() @IsString() before?: string;
}

export class AddMembersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) userIds: string[];
}
