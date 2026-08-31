import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PlatformOperationsController } from './platform-operations.controller';
import { PrismaPlatformOperationsRepository } from './platform-operations.repository';
import {
  PLATFORM_OPERATIONS_REPOSITORY,
  PlatformOperationsService,
} from './platform-operations.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformOperationsController],
  providers: [
    PlatformAdminGuard,
    PlatformOperationsService,
    PrismaPlatformOperationsRepository,
    {
      provide: PLATFORM_OPERATIONS_REPOSITORY,
      useExisting: PrismaPlatformOperationsRepository,
    },
  ],
})
export class PlatformOperationsModule {}
