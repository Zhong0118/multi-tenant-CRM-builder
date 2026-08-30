import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { ObjectsModule } from '../objects/objects.module';
import { DashboardsController } from './dashboards.controller';
import { PrismaDashboardRepository } from './dashboards.repository';
import {
  DASHBOARDS_REPOSITORY,
  DashboardsService,
} from './dashboards.service';

@Module({
  imports: [AuthModule, MembershipsModule, ObjectsModule],
  controllers: [DashboardsController],
  providers: [
    DashboardsService,
    PrismaDashboardRepository,
    {
      provide: DASHBOARDS_REPOSITORY,
      useExisting: PrismaDashboardRepository,
    },
  ],
  exports: [DashboardsService],
})
export class DashboardsModule {}
