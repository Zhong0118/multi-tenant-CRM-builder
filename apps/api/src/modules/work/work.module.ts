import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';
import { TeamActivityController } from './team-activity.controller';
import { TeamActivityService } from './team-activity.service';
import { WorkTasksController } from './work-tasks.controller';
import { WorkTasksService } from './work-tasks.service';

/** Members' everyday work: general tasks, daily reports and 团队动态. */
@Module({
  imports: [AuthModule, MembershipsModule, AuditModule],
  controllers: [
    WorkTasksController,
    DailyReportsController,
    TeamActivityController,
  ],
  providers: [WorkTasksService, DailyReportsService, TeamActivityService],
})
export class WorkModule {}
