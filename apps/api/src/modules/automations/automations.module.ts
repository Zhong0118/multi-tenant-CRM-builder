import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { RecordsModule } from '../records/records.module';
import {
  AutomationAdminController,
  AutomationRuntimeController,
} from './automations.controller';
import { AutomationsService } from './automations.service';
@Module({
  imports: [
    AuditModule,
    AuthModule,
    MembershipsModule,
    ObjectsModule,
    RecordsModule,
  ],
  controllers: [AutomationAdminController, AutomationRuntimeController],
  providers: [AutomationsService],
})
export class AutomationsModule {}
