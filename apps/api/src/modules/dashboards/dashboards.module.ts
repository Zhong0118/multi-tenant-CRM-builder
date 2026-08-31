import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { DASHBOARD_QUERY_EXECUTOR, DashboardEngine } from './dashboard-engine';
import { DashboardsController } from './dashboards.controller';
import {
  PrismaDashboardQueryExecutor,
  PrismaDashboardRepository,
} from './dashboards.repository';
import { DASHBOARDS_REPOSITORY, DashboardsService } from './dashboards.service';

@Module({
  imports: [AuthModule, AuditModule, MembershipsModule, ObjectsModule],
  controllers: [DashboardsController],
  providers: [
    DashboardsService,
    DashboardEngine,
    PrismaDashboardRepository,
    PrismaDashboardQueryExecutor,
    {
      provide: DASHBOARDS_REPOSITORY,
      useExisting: PrismaDashboardRepository,
    },
    {
      provide: DASHBOARD_QUERY_EXECUTOR,
      useExisting: PrismaDashboardQueryExecutor,
    },
  ],
  exports: [DashboardsService, DashboardEngine],
})
export class DashboardsModule {}
