import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';

import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { FieldsModule } from './modules/fields/fields.module';
import { ImportsModule } from './modules/imports/imports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { ObjectsModule } from './modules/objects/objects.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RecordsModule } from './modules/records/records.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { ViewsModule } from './modules/views/views.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: join(__dirname, '../../..', '.env'),
      isGlobal: true,
    }),
    AuditModule,
    AuthModule,
    DashboardsModule,
    FieldsModule,
    ImportsModule,
    IntegrationsModule,
    InvitationsModule,
    MembershipsModule,
    ObjectsModule,
    PermissionsModule,
    RecordsModule,
    TenantsModule,
    UsersModule,
    ViewsModule,
    HealthModule,
  ],
})
export class AppModule {}
