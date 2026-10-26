import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { DailyReportsController } from './daily-reports.controller';
import { DailyReportsService } from './daily-reports.service';
import { TeamActivityController } from './team-activity.controller';
import { TeamActivityService } from './team-activity.service';
import { WorkTasksController } from './work-tasks.controller';
import { WorkGoalsController } from './work-goals.controller';
import { WorkGoalsService } from './work-goals.service';
import { WorkTasksService } from './work-tasks.service';

/** Members' everyday work: general tasks, daily reports and 团队动态. */
@Module({
  imports: [AuthModule, MembershipsModule, AuditModule],
  controllers: [
    WorkGoalsController,
    WorkTasksController,
    DailyReportsController,
    TeamActivityController,
  ],
  providers: [
    WorkGoalsService,
    WorkTasksService,
    DailyReportsService,
    TeamActivityService,
  ],
})
export class WorkModule {}
