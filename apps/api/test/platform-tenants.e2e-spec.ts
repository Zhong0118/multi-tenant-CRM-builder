import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request, { type Agent } from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';

const origin = 'http://localhost:3000';
const verificationCode = '123456';
const platformPhone = '13922223333';
const tenantAdminPhone = '13922224444';
const regularPhone = '13922225555';
const tenantCode = 'e2e-platform-company';

describe('Platform tenant API (e2e)', () => {
  let app: INestApplication<App>;
  let adminDatabase: PrismaClient;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = verificationCode;
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
    const { createDatabaseClient } = await import('@crm/database');
    adminDatabase = createDatabaseClient(
      requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
    );
    app = (await createApp()) as INestApplication<App>;
  });

  beforeEach(async () => {
    await cleanup(adminDatabase);
  });

  it('guards platform routes and provisions a tenant through activation', async () => {
    const platform = await register(platformPhone, '平台管理员');
    const firstAdmin = await register(tenantAdminPhone, '公司管理员');
    const regular = await register(regularPhone, '普通用户');
    await adminDatabase.user.update({
      where: { phone: '+8613922223333' },
      data: { isPlatformAdmin: true },
    });

    await regular.get('/api/v1/platform/tenants').expect(403);
    await platform.get('/api/v1/platform/tenants').expect(200);

    const created = await platform
      .post('/api/v1/platform/tenants')
      .set('Origin', origin)
      .send({
        name: '端到端示例公司',
        code: tenantCode,
        firstAdminPhone: tenantAdminPhone,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      code: tenantCode,
      status: 'DRAFT',
      activeAdminCount: 0,
      firstAdminInvitation: {
        targetPhone: '+8613922224444',
        role: 'TENANT_ADMIN',
        status: 'PENDING',
      },
    });
    const tenantId: unknown = Reflect.get(created.body as object, 'id');
    if (typeof tenantId !== 'string') throw new Error('Expected tenant id');

    const summary = await platform
      .get('/api/v1/platform/tenants/summary')
      .expect(200);
    expect(summary.body).toMatchObject({
      total: 1,
      draft: 1,
      active: 0,
      suspended: 0,
      closed: 0,
    });
    await regular.get('/api/v1/platform/tenants/summary').expect(403);

    await platform
      .post('/api/v1/platform/tenants')
      .set('Origin', origin)
      .send({
        name: '重复公司',
        code: tenantCode,
        firstAdminPhone: tenantAdminPhone,
      })
      .expect(409);
    const invitation = await adminDatabase.tenantInvitation.findFirstOrThrow({
      where: {
        tenantId,
        targetPhone: '+8613922224444',
        role: 'TENANT_ADMIN',
        status: 'PENDING',
      },
    });
    expect(invitation.targetUserId).toBeTruthy();

    await platform
      .patch(`/api/v1/platform/tenants/${tenantId}/status`)
      .set('Origin', origin)
      .send({ status: 'ACTIVE' })
      .expect(409);
    const firstAdminUser = await adminDatabase.user.findUniqueOrThrow({
      where: { phone: '+8613922224444' },
    });
    await adminDatabase.tenantMember.create({
      data: {
        tenantId,
        userId: firstAdminUser.id,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    await platform
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          activeAdminCount: 1,
          firstAdminInvitation: { id: invitation.id, status: 'PENDING' },
        });
      });
    await platform
      .patch(`/api/v1/platform/tenants/${tenantId}/status`)
      .set('Origin', origin)
      .send({ status: 'ACTIVE', reason: '首位管理员已就绪' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          status: 'ACTIVE',
          activeAdminCount: 1,
        });
      });

    const activeSummary = await platform
      .get('/api/v1/platform/tenants/summary')
      .expect(200);
    expect(activeSummary.body).toMatchObject({
      total: 1,
      draft: 0,
      active: 1,
      suspended: 0,
      closed: 0,
    });

    await firstAdmin.get('/api/v1/me').expect(200);
  });

  afterAll(async () => {
    await cleanup(adminDatabase);
    await app.close();
    await adminDatabase.$disconnect();
  });

  async function register(phone: string, displayName: string): Promise<Agent> {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/verification-challenges')
      .set('Origin', origin)
      .send({ phone, purpose: 'REGISTER', deviceKey: `device-${phone}` })
      .expect(202);
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        phone,
        code: verificationCode,
        displayName,
        password: 'test-password1',
        deviceSummary: 'E2E',
      })
      .expect(201);
    return agent;
  }
});

async function cleanup(database: PrismaClient): Promise<void> {
  const phones = ['+8613922223333', '+8613922224444', '+8613922225555'];
  const tenant = await database.tenant.findUnique({
    where: { code: tenantCode },
  });
  const users = await database.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  if (tenant) {
    await database.auditLog.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenantInvitation.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.tenantMember.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenant.delete({ where: { id: tenant.id } });
  }
  const userIds = users.map(({ id }) => id);
  await database.session.deleteMany({ where: { userId: { in: userIds } } });
  await database.verificationChallenge.deleteMany({
    where: { phone: { in: phones } },
  });
  await database.user.deleteMany({ where: { id: { in: userIds } } });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
