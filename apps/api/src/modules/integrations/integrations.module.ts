import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
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
import { TelephonyLine } from './telephony/telephony-line';
import { TelephonySeats } from './telephony/telephony-seats';
import { TelephonyPlatformController } from './telephony/telephony-platform.controller';
import { TelephonyPlatformService } from './telephony/telephony-platform.service';

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
    TelephonyPlatformController,
  ],
  providers: [
    IntegrationsService,
    TelephonyService,
    TelephonyHookGuard,
    KuaimaProvider,
    TelephonyLine,
    TelephonySeats,
    TelephonyPlatformService,
    PlatformAdminGuard,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
