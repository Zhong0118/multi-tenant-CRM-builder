import {
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { MailService } from './mail.service';
import { MailTransport } from './mail-transport';

@Injectable()
class MailScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(MailScheduler.name);
  constructor(private readonly mail: MailService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.mail.sweep();
    } catch {
      this.logger.error('Mail queue sweep failed');
    } finally {
      this.running = false;
    }
  }
}

@Module({
  providers: [MailService, MailTransport, MailScheduler],
  exports: [MailService],
})
export class MailModule {}
