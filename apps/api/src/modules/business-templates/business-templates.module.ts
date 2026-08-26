import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { AuthModule } from '../auth/auth.module';
import { BusinessTemplatesController } from './business-templates.controller';
import { PrismaBusinessTemplateRepository } from './business-templates.repository';
import {
  BUSINESS_TEMPLATE_REPOSITORY,
  BusinessTemplatesService,
} from './business-templates.service';

@Module({
  imports: [AuthModule],
  controllers: [BusinessTemplatesController],
  providers: [
    BusinessTemplatesService,
    PlatformAdminGuard,
    PrismaBusinessTemplateRepository,
    {
      provide: BUSINESS_TEMPLATE_REPOSITORY,
      useExisting: PrismaBusinessTemplateRepository,
    },
  ],
  exports: [BusinessTemplatesService],
})
export class BusinessTemplatesModule {}
