import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../../infrastructure/database/database.service';

@Injectable()
export class NotificationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.sweep();
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      await this.database.transaction(
        (tx) => tx.$queryRaw`SELECT public.sweep_member_notifications(500)`,
      );
    } catch (error) {
      this.logger.error(
        'Notification generation failed; the next scheduled sweep will retry',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
