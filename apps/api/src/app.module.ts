import { Module } from '@nestjs/common';
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';

import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { OriginGuard } from './common/security/origin.guard';
import { RequestIdMiddleware } from './common/security/request-id.middleware';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessTemplatesModule } from './modules/business-templates/business-templates.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { ImportsModule } from './modules/imports/imports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { ObjectsModule } from './modules/objects/objects.module';
import { RecordsModule } from './modules/records/records.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { PlatformOperationsModule } from './modules/platform-operations/platform-operations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: join(__dirname, '../../..', '.env'),
      isGlobal: true,
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    BusinessTemplatesModule,
    DashboardsModule,
    ImportsModule,
    IntegrationsModule,
    InvitationsModule,
    MembershipsModule,
    ObjectsModule,
    RecordsModule,
    FollowUpsModule,
    TenantsModule,
    UsersModule,
    HealthModule,
    PlatformOperationsModule,
  ],
  providers: [ApiExceptionFilter, OriginGuard, RequestIdMiddleware],
})
export class AppModule {}
