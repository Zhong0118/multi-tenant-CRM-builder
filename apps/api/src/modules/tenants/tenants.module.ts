import { Module } from '@nestjs/common';

import { TenantsController } from './tenants.controller';
import { PrismaPlatformTenantRepository } from './tenants.repository';
import {
  generateInvitationToken,
  INVITATION_TOKEN_GENERATOR,
  PLATFORM_TENANT_REPOSITORY,
  TENANT_CLOCK,
  TenantsService,
} from './tenants.service';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [TenantsController],
  providers: [
    TenantsService,
    PlatformAdminGuard,
    PrismaPlatformTenantRepository,
    {
      provide: PLATFORM_TENANT_REPOSITORY,
      useExisting: PrismaPlatformTenantRepository,
    },
    { provide: TENANT_CLOCK, useValue: () => new Date() },
    { provide: INVITATION_TOKEN_GENERATOR, useValue: generateInvitationToken },
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
