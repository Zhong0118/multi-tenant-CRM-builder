import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { AuditModule } from '../audit/audit.module';
import { RecordRelationsController } from './record-relations.controller';
import { RecordRelationsService } from './record-relations.service';
@Module({
  imports: [AuthModule, MembershipsModule, ObjectsModule, AuditModule],
  controllers: [RecordRelationsController],
  providers: [RecordRelationsService],
})
export class RecordRelationsModule {}
