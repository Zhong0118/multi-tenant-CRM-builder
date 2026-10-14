import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { RecordPoolController } from './record-pool.controller';
import { RecordPoolService } from './record-pool.service';
import { RecordPoolScheduler } from './record-pool-scheduler';
import { RecordsController } from './records.controller';
import { PrismaRecordsRepository } from './records.repository';
import {
  RECORDS_CLOCK,
  RECORDS_ID_GENERATOR,
  RECORDS_REPOSITORY,
  RecordsService,
} from './records.service';

@Module({
  imports: [AuditModule, AuthModule, MembershipsModule, ObjectsModule],
  controllers: [RecordsController, RecordPoolController],
  providers: [
    RecordsService,
    RecordPoolService,
    RecordPoolScheduler,
    PrismaRecordsRepository,
    { provide: RECORDS_REPOSITORY, useExisting: PrismaRecordsRepository },
    { provide: RECORDS_CLOCK, useValue: () => new Date() },
    { provide: RECORDS_ID_GENERATOR, useValue: randomUUID },
  ],
  exports: [RecordsService, RECORDS_REPOSITORY],
})
export class RecordsModule {}
