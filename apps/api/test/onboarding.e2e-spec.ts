import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request, { type Agent } from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';
import { PrismaMembershipsRepository } from '../src/modules/memberships/memberships.repository';
import { InvitationsService } from '../src/modules/invitations/invitations.service';

const origin = 'http://localhost:3000';
const code = '123456';
const platformPhone = '13933330000';
const userAPhone = '13933331111';
const userBPhone = '13933332222';
const employeePhone = '13933334444';
const tenantACode = 'e2e-onboarding-a';
const tenantBCode = 'e2e-onboarding-b';

describe('Invitation and workspace onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let admin: PrismaClient;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = code;
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
    const { createDatabaseClient } = await import('@crm/database');
    admin = createDatabaseClient(
      requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
    );
    app = (await createApp()) as INestApplication<App>;
  });

  beforeEach(() => cleanup(admin));

  it('claims a pre-registration invitation once and enforces workspace isolation', async () => {
    const platform = await register(platformPhone, '平台管理员');
    await admin.user.update({
      where: { phone: normalized(platformPhone) },
      data: { isPlatformAdmin: true },
    });

    const tenantA = await createTenant(platform, tenantACode, userAPhone);
    await platform
      .get('/api/v1/platform/tenants?page=1&limit=20')
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;
        expect(body).toMatchObject({ page: 1, limit: 20 });
        if (!isRecord(body)) throw new Error('Expected tenant page');
        expect(typeof body.total).toBe('number');
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: tenantA, code: tenantACode }),
          ]),
        );
      });
    const userA = await register(userAPhone, '公司 A 管理员');
    const invitationsA = await userA.get('/api/v1/me/invitations').expect(200);
    const invitationAId = firstId(invitationsA.body);

    const acceptResults = await Promise.all([
      userA
        .post(`/api/v1/me/invitations/${invitationAId}/accept`)
        .set('Origin', origin),
      userA
        .post(`/api/v1/me/invitations/${invitationAId}/accept`)
        .set('Origin', origin),
    ]);
    expect(acceptResults.map(({ status }) => status)).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(acceptResults.every(({ status }) => status === 201)).toBe(true);
    const userARecord = await admin.user.findUniqueOrThrow({
      where: { phone: normalized(userAPhone) },
    });
    await expect(
      admin.tenantMember.count({
        where: { tenantId: tenantA, userId: userARecord.id },
      }),
    ).resolves.toBe(1);
    await activate(platform, tenantA);

    await userA
      .post(`/api/v1/workspaces/${tenantACode}/invitations`)
      .set('Origin', origin)
      .send({ phone: employeePhone, role: 'EMPLOYEE' })
      .expect(201);
    await userA
      .post(`/api/v1/workspaces/${tenantACode}/invitations`)
      .set('Origin', origin)
      .send({ phone: '13933335555', role: 'EMPLOYEE' })
      .expect(201);
    const firstPage = await userA
      .get(`/api/v1/workspaces/${tenantACode}/invitations?limit=1`)
      .expect(200);
    const firstPageBody = invitationPage(firstPage.body);
    expect(firstPageBody.items).toHaveLength(1);
    expect(firstPageBody.nextCursor).toEqual(expect.any(String));
    const secondPage = await userA
      .get(
        `/api/v1/workspaces/${tenantACode}/invitations?limit=1&cursor=${firstPageBody.nextCursor}`,
      )
      .expect(200);
    const secondPageBody = invitationPage(secondPage.body);
    expect(secondPageBody.items).toHaveLength(1);
    expect(secondPageBody.items[0]?.id).not.toBe(firstPageBody.items[0]?.id);

    const employee = await register(employeePhone, '公司 A 员工');
    const employeeInvitations = await employee
      .get('/api/v1/me/invitations')
      .expect(200);
    await employee
      .post(
        `/api/v1/me/invitations/${firstId(employeeInvitations.body)}/accept`,
      )
      .set('Origin', origin)
      .expect(201);
    await employee
      .get(`/api/v1/workspaces/${tenantACode}/members`)
      .expect(403)
      .expect((response) => {
        expect(response.body).toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
      });

    const tenantB = await createTenant(platform, tenantBCode, userBPhone);
    const userB = await register(userBPhone, '公司 B 管理员');
    const invitationsB = await userB.get('/api/v1/me/invitations').expect(200);
    await userB
      .post(`/api/v1/me/invitations/${firstId(invitationsB.body)}/accept`)
      .set('Origin', origin)
      .expect(201);
    await activate(platform, tenantB);

    await userA
      .get(`/api/v1/workspaces/${tenantACode}/members?page=1&limit=20`)
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;
        expect(body).toMatchObject({
          page: 1,
          limit: 20,
          activeAdminCount: 1,
        });
        if (!isRecord(body)) throw new Error('Expected member page');
        expect(typeof body.total).toBe('number');
        expect(Array.isArray(body.items)).toBe(true);
      });
    await userA.get(`/api/v1/workspaces/${tenantBCode}/members`).expect(403);

    const platformUser = await admin.user.findUniqueOrThrow({
      where: { phone: normalized(platformPhone) },
    });
    const platformMember = await admin.tenantMember.create({
      data: {
        tenantId: tenantA,
        userId: platformUser.id,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
    const memberA = await admin.tenantMember.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: tenantA, userId: userARecord.id } },
    });
    const concurrentDisables = await Promise.all([
      userA
        .patch(`/api/v1/workspaces/${tenantACode}/members/${memberA.id}`)
        .set('Origin', origin)
        .send({ status: 'DISABLED' }),
      userA
        .patch(`/api/v1/workspaces/${tenantACode}/members/${platformMember.id}`)
        .set('Origin', origin)
        .send({ status: 'DISABLED' }),
    ]);
    const disableStatuses = concurrentDisables
      .map(({ status }) => status)
      .sort();
    expect(disableStatuses[0]).toBe(200);
    // The losing request can reach the guard after its actor was disabled.
    expect([403, 409]).toContain(disableStatuses[1]);
    await expect(
      admin.tenantMember.count({
        where: {
          tenantId: tenantA,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      }),
    ).resolves.toBe(1);

    const refreshedMemberA = await admin.tenantMember.findUniqueOrThrow({
      where: { id: memberA.id },
    });
    if (refreshedMemberA.status === 'ACTIVE') {
      await userA
        .patch(`/api/v1/workspaces/${tenantACode}/members/${platformMember.id}`)
        .set('Origin', origin)
        .send({ status: 'ACTIVE' })
        .expect(200);
      await userA
        .patch(`/api/v1/workspaces/${tenantACode}/members/${memberA.id}`)
        .set('Origin', origin)
        .send({ status: 'DISABLED' })
        .expect(200);
    }
    await userA
      .get('/api/v1/me/workspaces')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              tenantCode: tenantACode,
              memberStatus: 'DISABLED',
            }),
          ]),
        );
      });
    await userA
      .get(`/api/v1/workspaces/${tenantACode}`)
      .expect(403)
      .expect((response) => {
        expect(response.body).toMatchObject({ code: 'MEMBERSHIP_INACTIVE' });
      });
  });

  it.each([{ status: 'REVOKED' }, { expiresAt: new Date('2030-01-01') }])(
    'preserves acceptance when it commits after an administrator read: %p',
    async (patch) => {
      const platform = await register(platformPhone, '平台管理员');
      await admin.user.update({
        where: { phone: normalized(platformPhone) },
        data: { isPlatformAdmin: true },
      });
      const tenantId = await createTenant(platform, tenantACode, userAPhone);
      await register(userAPhone, '接收人');
      const actor = await admin.user.findUniqueOrThrow({
        where: { phone: normalized(platformPhone) },
      });
      const target = await admin.user.findUniqueOrThrow({
        where: { phone: normalized(userAPhone) },
      });
      const invitation = await admin.tenantInvitation.findFirstOrThrow({
        where: { tenantId, status: 'PENDING' },
      });
      const member = await admin.tenantMember.create({
        data: {
          tenantId,
          userId: actor.id,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });
      const memberships = app.get(PrismaMembershipsRepository);
      const invitations = app.get(InvitationsService);
      await expect(
        memberships.withTenant(
          {
            tenantId,
            tenantCode: tenantACode,
            userId: actor.id,
            memberId: member.id,
            role: 'TENANT_ADMIN',
          },
          async (store) => {
            expect((await store.findInvitation(invitation.id))?.status).toBe(
              'PENDING',
            );
            // Independent real transaction commits acceptance while the first transaction holds a stale read.
            await invitations.accept(target, invitation.id, {
              requestId: 'accept-race',
            });
            await store.updateInvitation(invitation.id, patch);
          },
        ),
      ).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
      expect(
        await admin.tenantInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        }),
      ).toMatchObject({
        status: 'ACCEPTED',
        acceptedByUserId: target.id,
        expiresAt: invitation.expiresAt,
      });
      expect(
        await admin.tenantMember.count({
          where: { tenantId, userId: target.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
    },
  );

  afterAll(async () => {
    await cleanup(admin);
    await app.close();
    await admin.$disconnect();
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
        code,
        displayName,
        password: 'test-password1',
        deviceSummary: 'E2E',
      })
      .expect(201);
    return agent;
  }

  async function createTenant(
    agent: Agent,
    workspaceCode: string,
    phone: string,
  ): Promise<string> {
    const response = await agent
      .post('/api/v1/platform/tenants')
      .set('Origin', origin)
      .send({
        name: workspaceCode,
        code: workspaceCode,
        firstAdminPhone: phone,
      })
      .expect(201);
    const id: unknown = Reflect.get(response.body as object, 'id');
    if (typeof id !== 'string') throw new Error('Expected tenant id');
    return id;
  }

  function activate(agent: Agent, tenantId: string) {
    return agent
      .patch(`/api/v1/platform/tenants/${tenantId}/status`)
      .set('Origin', origin)
      .send({ status: 'ACTIVE' })
      .expect(200);
  }
});

async function cleanup(database: PrismaClient): Promise<void> {
  const phones = [platformPhone, userAPhone, userBPhone, employeePhone].map(
    normalized,
  );
  const tenants = await database.tenant.findMany({
    where: { code: { in: [tenantACode, tenantBCode] } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  await database.auditLog.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await database.tenantInvitation.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await database.tenantMember.deleteMany({
    where: { tenantId: { in: tenantIds } },
  });
  await database.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  const users = await database.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  await database.session.deleteMany({ where: { userId: { in: userIds } } });
  await database.verificationChallenge.deleteMany({
    where: { phone: { in: phones } },
  });
  await database.user.deleteMany({ where: { id: { in: userIds } } });
}

function firstId(body: unknown): string {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== 'object') {
    throw new Error('Expected invitation list');
  }
  const id: unknown = Reflect.get(body[0], 'id');
  if (typeof id !== 'string') throw new Error('Expected invitation id');
  return id;
}

function invitationPage(body: unknown): {
  items: Array<{ id?: unknown }>;
  nextCursor?: string;
} {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Expected invitation page');
  }
  const items: unknown = Reflect.get(body, 'items');
  if (!isUnknownArray(items)) throw new Error('Expected invitation page items');
  const nextCursor: unknown = Reflect.get(body, 'nextCursor');
  if (nextCursor !== undefined && typeof nextCursor !== 'string') {
    throw new Error('Expected invitation page cursor');
  }
  return {
    items: items.map((item) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error('Expected invitation page item');
      }
      const id: unknown = Reflect.get(item, 'id');
      return { id };
    }),
    nextCursor,
  };
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalized(phone: string): string {
  return `+86${phone}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
