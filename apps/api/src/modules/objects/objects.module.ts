import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsController } from './objects.controller';
import { PrismaObjectsRepository } from './objects.repository';
import {
  OBJECTS_CLOCK,
  OBJECTS_ID_GENERATOR,
  OBJECTS_REPOSITORY,
  ObjectsService,
} from './objects.service';
import {
  PrismaPublishedObjectRepository,
  type PublishedObjectRepository,
} from './published-object.repository';
import {
  PUBLISHED_OBJECT_REPOSITORY,
  PublishedObjectService,
} from './published-object.service';

@Module({
  imports: [AuditModule, AuthModule, MembershipsModule],
  controllers: [ObjectsController],
  providers: [
    ObjectsService,
    PublishedObjectService,
    PrismaObjectsRepository,
    PrismaPublishedObjectRepository,
    { provide: OBJECTS_REPOSITORY, useExisting: PrismaObjectsRepository },
    { provide: OBJECTS_CLOCK, useValue: () => new Date() },
    { provide: OBJECTS_ID_GENERATOR, useValue: randomUUID },
    {
      provide: PUBLISHED_OBJECT_REPOSITORY,
      useExisting: PrismaPublishedObjectRepository,
    } satisfies {
      provide: symbol;
      useExisting: new (...args: never[]) => PublishedObjectRepository;
    },
  ],
  exports: [ObjectsService, PublishedObjectService],
})
export class ObjectsModule {}
