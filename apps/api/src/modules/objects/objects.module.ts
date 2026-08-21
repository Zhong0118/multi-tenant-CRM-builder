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

@Module({
  imports: [AuditModule, AuthModule, MembershipsModule],
  controllers: [ObjectsController],
  providers: [
    ObjectsService,
    PrismaObjectsRepository,
    { provide: OBJECTS_REPOSITORY, useExisting: PrismaObjectsRepository },
    { provide: OBJECTS_CLOCK, useValue: () => new Date() },
    { provide: OBJECTS_ID_GENERATOR, useValue: randomUUID },
  ],
  exports: [ObjectsService],
})
export class ObjectsModule {}
