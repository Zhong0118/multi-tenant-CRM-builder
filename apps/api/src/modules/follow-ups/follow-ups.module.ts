import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { AuditModule } from '../audit/audit.module';
import { FollowUpsController } from './follow-ups.controller';
import { FollowUpsRepository } from './follow-ups.repository';
import { FollowUpsService } from './follow-ups.service';
@Module({
  imports: [AuthModule, MembershipsModule, ObjectsModule, AuditModule],
  controllers: [FollowUpsController],
  providers: [FollowUpsRepository, FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
