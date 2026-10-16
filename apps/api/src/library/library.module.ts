import { Module } from '@nestjs/common';
import { PeopleModule } from '../people/people.module';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';

/** Group policies and HR forms with read confirmations */
@Module({
  imports: [PeopleModule],
  controllers: [LibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
