import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { RecordsModule } from '../records/records.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationScheduler } from './notification-scheduler';
@Module({
  imports: [AuthModule, MembershipsModule, RecordsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationScheduler],
})
export class NotificationsModule {}
