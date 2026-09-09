import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { AuditModule } from '../audit/audit.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentsService } from './attachments.service';
@Module({
  imports: [AuthModule, MembershipsModule, ObjectsModule, AuditModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsRepository, AttachmentsService],
})
export class AttachmentsModule {}
