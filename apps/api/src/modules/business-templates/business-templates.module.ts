import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BusinessTemplatesController } from './business-templates.controller';
import { PrismaBusinessTemplateRepository } from './business-templates.repository';
import {
  BUSINESS_TEMPLATE_REPOSITORY,
  BusinessTemplatesService,
} from './business-templates.service';
import { TemplateApplicationController } from './template-application.controller';
import { PrismaTemplateApplicationRepository } from './template-application.repository';
import {
  TEMPLATE_APPLICATION_ID_GENERATOR,
  TEMPLATE_APPLICATION_REPOSITORY,
  TemplateApplicationService,
} from './template-application.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BusinessTemplatesController, TemplateApplicationController],
  providers: [
    BusinessTemplatesService,
    TemplateApplicationService,
    PlatformAdminGuard,
    PrismaBusinessTemplateRepository,
    PrismaTemplateApplicationRepository,
    {
      provide: BUSINESS_TEMPLATE_REPOSITORY,
      useExisting: PrismaBusinessTemplateRepository,
    },
    {
      provide: TEMPLATE_APPLICATION_REPOSITORY,
      useExisting: PrismaTemplateApplicationRepository,
    },
    { provide: TEMPLATE_APPLICATION_ID_GENERATOR, useValue: randomUUID },
  ],
  exports: [BusinessTemplatesService, TemplateApplicationService],
})
export class BusinessTemplatesModule {}
