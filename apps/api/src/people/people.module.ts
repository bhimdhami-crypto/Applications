import { Module } from '@nestjs/common';
import { StorageService } from '../common/storage.service';
import { ChangeRequestsService } from './change-requests.service';
import { DocumentsService } from './documents.service';
import { PeopleAccess } from './people-access.service';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

@Module({
  controllers: [PeopleController],
  providers: [PeopleService, PeopleAccess, DocumentsService, ChangeRequestsService, StorageService],
  exports: [PeopleAccess, StorageService, DocumentsService],
})
export class PeopleModule {}
