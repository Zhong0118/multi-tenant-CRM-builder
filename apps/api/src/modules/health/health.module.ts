import { Module } from '@nestjs/common';

import { RuntimeHealthService } from '../platform-operations/runtime-health.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [RuntimeHealthService],
})
export class HealthModule {}
