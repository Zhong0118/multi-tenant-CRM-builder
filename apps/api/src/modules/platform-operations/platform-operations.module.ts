import { CompanyAuditController } from './company-audit.controller';
import { CompanyAuditService } from './company-audit.service';
import { MembershipsModule } from '../memberships/memberships.module';
import { RuntimeHealthService } from './runtime-health.service';
import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PlatformOperationsController } from './platform-operations.controller';
import { PrismaPlatformOperationsRepository } from './platform-operations.repository';
import {
  PLATFORM_OPERATIONS_REPOSITORY,
  PlatformOperationsService,
} from './platform-operations.service';

@Module({
  imports: [AuthModule, MembershipsModule],
  controllers: [PlatformOperationsController, CompanyAuditController],
  providers: [
    CompanyAuditService,
    RuntimeHealthService,
    PlatformAdminGuard,
    PlatformOperationsService,
    PrismaPlatformOperationsRepository,
    {
      provide: PLATFORM_OPERATIONS_REPOSITORY,
      useExisting: PrismaPlatformOperationsRepository,
    },
  ],
})
export class PlatformOperationsModule {}
