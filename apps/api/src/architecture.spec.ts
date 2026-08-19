import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { TenantsController } from './modules/tenants/tenants.controller';
import { TenantsService } from './modules/tenants/tenants.service';
import { InvitationsController } from './modules/invitations/invitations.controller';
import { InvitationsService } from './modules/invitations/invitations.service';
import { MembershipsController } from './modules/memberships/memberships.controller';
import { MembershipsService } from './modules/memberships/memberships.service';
import { ObjectsController } from './modules/objects/objects.controller';
import { ObjectsService } from './modules/objects/objects.service';
import { FieldsController } from './modules/fields/fields.controller';
import { FieldsService } from './modules/fields/fields.service';
import { ViewsController } from './modules/views/views.controller';
import { ViewsService } from './modules/views/views.service';
import { PermissionsController } from './modules/permissions/permissions.controller';
import { PermissionsService } from './modules/permissions/permissions.service';
import { RecordsController } from './modules/records/records.controller';
import { RecordsService } from './modules/records/records.service';
import { DashboardsController } from './modules/dashboards/dashboards.controller';
import { DashboardsService } from './modules/dashboards/dashboards.service';
import { ImportsController } from './modules/imports/imports.controller';
import { ImportsService } from './modules/imports/imports.service';
import { IntegrationsController } from './modules/integrations/integrations.controller';
import { IntegrationsService } from './modules/integrations/integrations.service';
import { AuditController } from './modules/audit/audit.controller';
import { AuditService } from './modules/audit/audit.service';

const services = [
  AuthService,
  UsersService,
  TenantsService,
  InvitationsService,
  MembershipsService,
  ObjectsService,
  FieldsService,
  ViewsService,
  PermissionsService,
  RecordsService,
  DashboardsService,
  ImportsService,
  IntegrationsService,
  AuditService,
];

const controllers = [
  AuthController,
  UsersController,
  TenantsController,
  InvitationsController,
  MembershipsController,
  ObjectsController,
  FieldsController,
  ViewsController,
  PermissionsController,
  RecordsController,
  DashboardsController,
  ImportsController,
  IntegrationsController,
  AuditController,
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

  it('does not expose placeholder business handlers', () => {
    for (const controller of controllers) {
      expect(Object.getOwnPropertyNames(controller.prototype)).toEqual([
        'constructor',
      ]);
    }
  });
});
