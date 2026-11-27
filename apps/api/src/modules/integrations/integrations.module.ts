import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ObjectsModule } from '../objects/objects.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { RecordsModule } from '../records/records.module';
import {
  TelephonyController,
  TelephonyHookController,
  TelephonyHookGuard,
} from './telephony/telephony.controller';
import { TelephonyService } from './telephony/telephony.service';
import { KuaimaProvider } from './telephony/telephony-provider';

import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    ObjectsModule,
    RecordsModule,
    MembershipsModule,
  ],
  controllers: [
    IntegrationsController,
    TelephonyController,
    TelephonyHookController,
  ],
  providers: [
    IntegrationsService,
    TelephonyService,
    TelephonyHookGuard,
    KuaimaProvider,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
