import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@crm/database';
import type { App } from 'supertest/types';

import { createApp } from '../../src/bootstrap';
import { hashSessionToken } from '../../src/modules/auth/session.service';

const origin = 'http://localhost:3000';

export const CRITICAL_TENANT_A = 'critical-a';
export const CRITICAL_TENANT_B = 'critical-b';
export const CRITICAL_AUTH_PHONE = '+8613911113333';

const PHONES = {
  admin: '+8613911113001',
  employee: '+8613911113002',
  other: '+8613911113003',
  tenantB: '+8613911113004',
};

export interface CriticalActor {
  userId: string;
  memberId: string;
  cookie: string;
}

export interface CriticalHarness {
  app: INestApplication<App>;
  adminDatabase: PrismaClient;
  runtimeDatabase: PrismaClient;
}

export interface CriticalFixture {
  tenantA: { id: string; code: string };
  tenantB: { id: string; code: string };
  admin: CriticalActor;
  employee: CriticalActor;
  otherEmployee: CriticalActor;
  object: { id: string; code: string };
  ownedRecord: { id: string; version: number };
  otherRecord: { id: string; version: number };
  workflowRecord: { id: string; version: number };
  rollbackObject: { id: string; code: string };
  rollbackTargetObject: { id: string; code: string };
  rollbackRecord: { id: string; version: number };
}

export async function createCriticalHarness(): Promise<CriticalHarness> {
  process.env.NODE_ENV = 'test';
  process.env.DEV_VERIFICATION_CODE = '123456';
  process.env.WEB_ORIGIN = origin;
  process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
  const { createDatabaseClient } = await import('@crm/database');
  const adminDatabase = createDatabaseClient(
    requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
  );
  const runtimeDatabase = createDatabaseClient(
    requiredEnvironment('TEST_DATABASE_URL'),
  );
  const app = (await createApp()) as INestApplication<App>;
  return { app, adminDatabase, runtimeDatabase };
}

export async function provisionCriticalFixture(
  harness: CriticalHarness,
): Promise<CriticalFixture> {
  await cleanupCriticalData(harness.adminDatabase);
  const database = harness.adminDatabase;
  const now = new Date('2026-09-17T00:00:00.000Z');

  const tenantA = await database.tenant.create({
    data: {
      id: randomUUID(),
      name: 'Critical Tenant A',
      code: CRITICAL_TENANT_A,
      status: 'ACTIVE',
      activatedAt: now,
    },
  });
  const tenantB = await database.tenant.create({
    data: {
      id: randomUUID(),
      name: 'Critical Tenant B',
      code: CRITICAL_TENANT_B,
      status: 'ACTIVE',
      activatedAt: now,
    },
  });

  const [adminUser, employeeUser, otherUser, tenantBUser] = await Promise.all(
    [
      { phone: PHONES.admin, name: 'Critical Admin' },
      { phone: PHONES.employee, name: 'Critical Employee' },
      { phone: PHONES.other, name: 'Critical Other' },
      { phone: PHONES.tenantB, name: 'Critical Tenant B Admin' },
    ].map(({ phone, name }) =>
      database.user.create({
        data: {
          id: randomUUID(),
          displayName: name,
          phone,
          phoneVerifiedAt: now,
          passwordHash: 'not-used-by-direct-session-fixture',
          status: 'ACTIVE',
        },
      }),
    ),
  );

  const [adminMember, employeeMember, otherMember, tenantBMember] =
    await Promise.all([
      database.tenantMember.create({
        data: {
          id: randomUUID(),
          tenantId: tenantA.id,
          userId: adminUser.id,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
          joinedAt: now,
        },
      }),
      database.tenantMember.create({
        data: {
          id: randomUUID(),
          tenantId: tenantA.id,
          userId: employeeUser.id,
          role: 'EMPLOYEE',
          status: 'ACTIVE',
          joinedAt: now,
        },
      }),
      database.tenantMember.create({
        data: {
          id: randomUUID(),
          tenantId: tenantA.id,
          userId: otherUser.id,
          role: 'EMPLOYEE',
          status: 'ACTIVE',
          joinedAt: now,
        },
      }),
      database.tenantMember.create({
        data: {
          id: randomUUID(),
          tenantId: tenantB.id,
          userId: tenantBUser.id,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
          joinedAt: now,
        },
      }),
    ]);

  const tokens = {
    admin: 'critical-admin-token',
    employee: 'critical-employee-token',
    other: 'critical-other-token',
  };
  // Fixture metadata can use a frozen 2026-09-17 `now`, but session expiry is
  // compared to wall-clock time at request. A near-future date would make the
  // required Critical gate fail deterministically after that instant.
  const expiresAt = new Date('2099-12-31T00:00:00.000Z');
  await Promise.all(
    [
      { userId: adminUser.id, token: tokens.admin },
      { userId: employeeUser.id, token: tokens.employee },
      { userId: otherUser.id, token: tokens.other },
    ].map(({ userId, token }) =>
      database.session.create({
        data: {
          id: randomUUID(),
          userId,
          tokenHash: hashSessionToken(token),
          expiresAt,
        },
      }),
    ),
  );

  const admin: CriticalActor = {
    userId: adminUser.id,
    memberId: adminMember.id,
    cookie: `crm_session=${tokens.admin}`,
  };
  const employee: CriticalActor = {
    userId: employeeUser.id,
    memberId: employeeMember.id,
    cookie: `crm_session=${tokens.employee}`,
  };
  const otherEmployee: CriticalActor = {
    userId: otherUser.id,
    memberId: otherMember.id,
    cookie: `crm_session=${tokens.other}`,
  };

  const leadWorkflow = {
    initialStateKey: 'new',
    states: [
      { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      { key: 'qualified', label: '已转化', sortOrder: 20, isTerminal: false },
    ],
    transitions: [
      {
        key: 'qualify',
        label: '转化',
        fromStateKey: 'new',
        toStateKey: 'qualified',
        allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
        requiredFieldKeys: [],
        actions: [],
      },
      {
        key: 'reopen',
        label: '重开',
        fromStateKey: 'qualified',
        toStateKey: 'new',
        allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
        requiredFieldKeys: [],
        actions: [],
      },
    ],
  };

  const leadObject = await publishObject(database, {
    tenantId: tenantA.id,
    publisherMemberId: adminMember.id,
    code: 'leads',
    name: '销售线索',
    fields: [
      { key: 'name', label: '姓名', type: 'TEXT', required: true, access: 'EDIT' },
      {
        key: 'secret',
        label: '内部备注',
        type: 'TEXTAREA',
        required: false,
        access: 'HIDDEN',
      },
    ],
    access: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      readScope: 'OWN',
      updateScope: 'OWN',
    },
    workflow: leadWorkflow,
    now,
  });

  const invoiceObject = await publishObject(database, {
    tenantId: tenantA.id,
    publisherMemberId: adminMember.id,
    code: 'invoices',
    name: '发票',
    fields: [
      { key: 'name', label: '名称', type: 'TEXT', required: true, access: 'EDIT' },
    ],
    access: {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      readScope: 'ALL',
      updateScope: 'NONE',
    },
    now,
  });

  const dealObject = await publishObject(database, {
    tenantId: tenantA.id,
    publisherMemberId: adminMember.id,
    code: 'deals',
    name: '商机',
    fields: [
      { key: 'name', label: '名称', type: 'TEXT', required: true, access: 'EDIT' },
    ],
    access: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      readScope: 'OWN',
      updateScope: 'OWN',
    },
    workflow: {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '进行中', sortOrder: 10, isTerminal: false },
        { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'close-won',
          label: '标记赢单',
          fromStateKey: 'open',
          toStateKey: 'won',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'follow-deal',
              type: 'CREATE_FOLLOW_UP',
              target: { source: 'SOURCE_RECORD' },
              title: { source: 'LITERAL', value: 'Critical follow-up' },
              dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
              assignee: { source: 'ACTOR' },
            },
            {
              key: 'create-invoice',
              type: 'CREATE_RECORD',
              targetObjectCode: 'invoices',
              values: { name: { source: 'LITERAL', value: '发票' } },
            },
          ],
        },
      ],
    },
    now,
  });

  const tenantBObject = await publishObject(database, {
    tenantId: tenantB.id,
    publisherMemberId: tenantBMember.id,
    code: 'leads',
    name: '外部线索',
    fields: [
      { key: 'name', label: '姓名', type: 'TEXT', required: true, access: 'EDIT' },
    ],
    access: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      readScope: 'ALL',
      updateScope: 'ALL',
    },
    now,
  });

  const [ownedRecord, otherRecord, workflowRecord, rollbackRecord] =
    await Promise.all([
      createRecord(database, tenantA.id, {
        objectId: leadObject.id,
        ownerMemberId: employeeMember.id,
        title: '员工自己的线索',
        values: { name: '员工自己的线索', secret: 'hidden-owned' },
        statusKey: 'new',
        recordNo: 1,
      }),
      createRecord(database, tenantA.id, {
        objectId: leadObject.id,
        ownerMemberId: otherMember.id,
        title: '他人线索',
        values: { name: '他人线索', secret: 'hidden-other' },
        statusKey: 'new',
        recordNo: 2,
      }),
      createRecord(database, tenantA.id, {
        objectId: leadObject.id,
        ownerMemberId: employeeMember.id,
        title: '流程线索',
        values: { name: '流程线索' },
        statusKey: 'new',
        recordNo: 3,
      }),
      createRecord(database, tenantA.id, {
        objectId: dealObject.id,
        ownerMemberId: employeeMember.id,
        title: '回滚商机',
        values: { name: '回滚商机' },
        statusKey: 'open',
        recordNo: 1,
      }),
    ]);

  await createRecord(database, tenantB.id, {
    objectId: tenantBObject.id,
    ownerMemberId: tenantBMember.id,
    title: '租户 B 线索',
    values: { name: '租户 B 线索' },
    statusKey: null,
    recordNo: 1,
  });

  await Promise.all([
    database.recordCounter.create({
      data: {
        tenantId: tenantA.id,
        objectId: leadObject.id,
        nextRecordNo: BigInt(4),
      },
    }),
    database.recordCounter.create({
      data: {
        tenantId: tenantA.id,
        objectId: dealObject.id,
        nextRecordNo: BigInt(2),
      },
    }),
    database.recordCounter.create({
      data: {
        tenantId: tenantA.id,
        objectId: invoiceObject.id,
        nextRecordNo: BigInt(1),
      },
    }),
    database.recordCounter.create({
      data: {
        tenantId: tenantB.id,
        objectId: tenantBObject.id,
        nextRecordNo: BigInt(2),
      },
    }),
  ]);

  return {
    tenantA: { id: tenantA.id, code: CRITICAL_TENANT_A },
    tenantB: { id: tenantB.id, code: CRITICAL_TENANT_B },
    admin,
    employee,
    otherEmployee,
    object: { id: leadObject.id, code: 'leads' },
    ownedRecord,
    otherRecord,
    workflowRecord,
    rollbackObject: { id: dealObject.id, code: 'deals' },
    rollbackTargetObject: { id: invoiceObject.id, code: 'invoices' },
    rollbackRecord,
  };
}

export async function closeCriticalHarness(
  harness: CriticalHarness,
): Promise<void> {
  await cleanupCriticalData(harness.adminDatabase);
  await harness.app.close();
  await Promise.allSettled([
    harness.adminDatabase.$disconnect(),
    harness.runtimeDatabase.$disconnect(),
  ]);
}

async function cleanupCriticalData(database: PrismaClient): Promise<void> {
  const tenants = await database.tenant.findMany({
    where: { code: { in: [CRITICAL_TENANT_A, CRITICAL_TENANT_B] } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const phones = [...Object.values(PHONES), CRITICAL_AUTH_PHONE];
  const users = await database.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);

  if (tenantIds.length > 0) {
    await database.auditLog.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordTransitionHistory.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordFollowUp.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.record.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordCounter.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectWorkflowDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectDefinition.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { activePublicationId: null },
    });
    await database.objectPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.fieldPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.viewDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectPublication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.fieldDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenantInvitation.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenantMember.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }

  if (userIds.length > 0) {
    await database.session.deleteMany({ where: { userId: { in: userIds } } });
  }
  await database.verificationChallenge.deleteMany({
    where: { phone: { in: phones } },
  });
  if (userIds.length > 0) {
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function publishObject(
  database: PrismaClient,
  input: {
    tenantId: string;
    publisherMemberId: string;
    code: string;
    name: string;
    fields: Array<{
      key: string;
      label: string;
      type: string;
      required: boolean;
      access: 'EDIT' | 'READ_ONLY' | 'HIDDEN';
    }>;
    access: {
      canCreate: boolean;
      canRead: boolean;
      canUpdate: boolean;
      readScope: 'ALL' | 'OWN' | 'NONE';
      updateScope: 'ALL' | 'OWN' | 'NONE';
    };
    workflow?: unknown;
    now: Date;
  },
): Promise<{ id: string }> {
  const object = await database.objectDefinition.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      code: input.code,
      titleFieldKey: 'name',
      status: 'ACTIVE',
      version: 1,
      sortOrder: 0,
    },
  });
  const publicationId = randomUUID();
  const configuration = {
    publication: {
      id: publicationId,
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: input.now.toISOString(),
    },
    object: {
      id: object.id,
      code: input.code,
      name: input.name,
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 0,
    },
    fields: input.fields.map((field, index) => ({
      id: randomUUID(),
      fieldKey: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: index * 10,
      isSystem: false,
    })),
    defaultView: {
      code: 'default',
      name: '全部',
      columnFieldKeys: input.fields.map((field) => field.key),
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: input.access.canCreate,
      canRead: input.access.canRead,
      canUpdate: input.access.canUpdate,
      canDelete: false,
      readScope: input.access.readScope,
      updateScope: input.access.updateScope,
      fields: Object.fromEntries(
        input.fields.map((field) => [field.key, field.access]),
      ),
    },
    ...(input.workflow ? { workflow: input.workflow } : {}),
  };
  await database.objectPublication.create({
    data: {
      id: publicationId,
      tenantId: input.tenantId,
      objectId: object.id,
      publicationNo: 1,
      sourceDraftVersion: 1,
      configuration: configuration as Prisma.InputJsonValue,
      changeSummary: {},
      publishedByMemberId: input.publisherMemberId,
      publishedAt: input.now,
    },
  });
  await database.objectDefinition.update({
    where: { id: object.id },
    data: {
      activePublicationId: publicationId,
      publishedAt: input.now,
    },
  });
  return { id: object.id };
}

async function createRecord(
  database: PrismaClient,
  tenantId: string,
  input: {
    objectId: string;
    ownerMemberId: string | null;
    title: string;
    values: Record<string, unknown>;
    statusKey: string | null;
    recordNo: number;
  },
): Promise<{ id: string; version: number }> {
  return database.record.create({
    data: {
      id: randomUUID(),
      tenantId,
      objectId: input.objectId,
      recordNo: BigInt(input.recordNo),
      ownerMemberId: input.ownerMemberId,
      statusKey: input.statusKey,
      title: input.title,
      data: input.values as Prisma.InputJsonValue,
      source: 'MANUAL',
      version: 1,
      createdByMemberId: input.ownerMemberId,
    },
    select: { id: true, version: true },
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
