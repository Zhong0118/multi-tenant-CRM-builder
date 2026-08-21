import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { OriginGuard } from './common/security/origin.guard';
import { RequestIdMiddleware } from './common/security/request-id.middleware';
import { DatabaseContextRunner } from './infrastructure/database/context-runner';
import { DatabaseService } from './infrastructure/database/database.service';
import { AuthService } from './modules/auth/auth.service';
import { UsersService } from './modules/users/users.service';
import { TenantsService } from './modules/tenants/tenants.service';
import { InvitationsService } from './modules/invitations/invitations.service';
import { MembershipsService } from './modules/memberships/memberships.service';
import { ObjectsService } from './modules/objects/objects.service';

process.env.NODE_ENV = 'test';
process.env.DEV_VERIFICATION_CODE = '123456';
import { RecordsService } from './modules/records/records.service';
import { DashboardsService } from './modules/dashboards/dashboards.service';
import { ImportsService } from './modules/imports/imports.service';
import { IntegrationsService } from './modules/integrations/integrations.service';
import { AuditService } from './modules/audit/audit.service';

const services = [
  AuthService,
  UsersService,
  TenantsService,
  InvitationsService,
  MembershipsService,
  ObjectsService,
  RecordsService,
  DashboardsService,
  ImportsService,
  IntegrationsService,
  AuditService,
];

describe('AppModule architecture', () => {
  it('registers every approved domain service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    for (const service of services) {
      expect(moduleRef.get(service, { strict: false })).toBeInstanceOf(service);
    }
  });

  it('registers shared database and request security infrastructure', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(DatabaseService, { strict: false })).toBeInstanceOf(
      DatabaseService,
    );
    expect(
      moduleRef.get(DatabaseContextRunner, { strict: false }),
    ).toBeInstanceOf(DatabaseContextRunner);
    expect(
      moduleRef.get(RequestIdMiddleware, { strict: false }),
    ).toBeInstanceOf(RequestIdMiddleware);
    expect(moduleRef.get(OriginGuard, { strict: false })).toBeInstanceOf(
      OriginGuard,
    );
    expect(moduleRef.get(ApiExceptionFilter, { strict: false })).toBeInstanceOf(
      ApiExceptionFilter,
    );
  });
});
