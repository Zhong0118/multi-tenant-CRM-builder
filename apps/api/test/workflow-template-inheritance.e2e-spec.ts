import type { BusinessTemplatesService } from '../src/modules/business-templates/business-templates.service';
import type { Prisma } from '@crm/database';
import type { TemplateDetail } from '../src/modules/business-templates/business-template.presenter';
import type { BusinessTemplateVersion } from '../src/modules/business-templates/business-templates.repository';
import type { TemplateApplicationResult } from '../src/modules/business-templates/template-application.repository';
import type {
  TemplateInitializationResponseDto,
  TemplateInitializationGroupDto,
  PublishTemplateInitializationDto,
} from '../src/modules/objects/dto/template-initialization.dto';
import type { WorkGoalSettingsDto } from '../src/modules/work/dto/work-goals.dto';
import type { RecordResponseDto } from '../src/modules/records/dto/record.dto';
import type { RecordOwnershipResponseDto } from '../src/modules/records/dto/record-pool.dto';
import type { FollowUpResponseDto } from '../src/modules/follow-ups/follow-ups.dto';
import type { AutomationExecution } from '../src/modules/automations/automation.types';
type Capture = Awaited<ReturnType<BusinessTemplatesService['capturePreview']>>;
import { randomUUID, createHash } from 'node:crypto';
import request from 'supertest';
import { hashSessionToken } from '../src/modules/auth/session.service';
import type { BusinessTemplateConfiguration } from '../src/modules/business-templates/business-template.schema';
import type { PublishedObjectSchema } from '../src/modules/objects/object-schema';
import {
  closeCriticalHarness,
  createCriticalHarness,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);
let h: CriticalHarness;
const origin = 'http://localhost:3000';
const response = <T>(r: { body: unknown }): T => r.body as T;
const api = (
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  cookie: string,
  body?: object,
) => {
  const call = request(h.app.getHttpServer())
    [method]('/api/v1' + path)
    .set('Cookie', cookie)
    .set('Origin', origin);
  return body ? call.send(body) : call;
};
async function actor(
  tenantId: string,
  role: 'TENANT_ADMIN' | 'EMPLOYEE',
  platform = false,
) {
  const token = randomUUID();
  const user = await h.adminDatabase.user.create({
    data: {
      phone: '+t' + randomUUID().replaceAll('-', '').slice(0, 20),
      phoneVerifiedAt: new Date(),
      displayName: 'Template tester',
      passwordHash: 'test',
      isPlatformAdmin: platform,
    },
  });
  const member = await h.adminDatabase.tenantMember.create({
    data: {
      tenantId,
      userId: user.id,
      role,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  await h.adminDatabase.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date('2099-12-31'),
    },
  });
  return {
    userId: user.id,
    memberId: member.id,
    cookie: 'crm_session=' + token,
  };
}
function schema(code: string, other: string): PublishedObjectSchema {
  const fields: PublishedObjectSchema['fields'] = [
    {
      id: randomUUID(),
      fieldKey: 'name',
      label: '名称',
      type: 'TEXT',
      required: true,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 0,
      isSystem: false,
    },
    {
      id: randomUUID(),
      fieldKey: 'inquiry',
      label: '询单',
      type: 'TEXT',
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 10,
      isSystem: false,
    },
  ];
  return {
    publication: {
      id: randomUUID(),
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: new Date().toISOString(),
    },
    object: {
      id: randomUUID(),
      code,
      name: code,
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: code.includes('customers') ? 0 : 10,
    },
    fields,
    defaultView: {
      code: 'default',
      name: '全部',
      columnFieldKeys: ['name', 'inquiry'],
      searchFieldKeys: ['inquiry'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'OWN',
      fields: { name: 'EDIT', inquiry: 'EDIT' },
    },
    workflow: {
      initialStateKey: 'new',
      states: [
        { key: 'new', label: '新建', sortOrder: 0, isTerminal: false },
        { key: 'confirmed', label: '确认', sortOrder: 10, isTerminal: true },
      ],
      transitions: [
        {
          key: 'confirm',
          label: '确认',
          fromStateKey: 'new',
          toStateKey: 'confirmed',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'note',
              type: 'UPDATE_RECORD',
              target: 'SOURCE_RECORD',
              values: { inquiry: { source: 'LITERAL', value: 'confirmed' } },
            },
          ],
        },
      ],
    },
    automations: [
      {
        key: 'create-linked',
        label: '创建关联',
        enabled: true,
        allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
        trigger: { type: 'MANUAL' },
        targetObjectCode: other,
        owner: 'ACTOR',
        mappings: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
      },
    ],
  };
}
async function fixture(
  mutate?: (published: PublishedObjectSchema, memberId: string) => void,
) {
  const source = await h.adminDatabase.tenant.create({
    data: {
      code: 'flow-src-' + randomUUID(),
      name: 'Workflow source',
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });
  const target = await h.adminDatabase.tenant.create({
    data: {
      code: 'flow-dst-' + randomUUID(),
      name: 'Memberless target',
      status: 'ACTIVE',
      activatedAt: new Date(),
      timezone: 'Pacific/Kiritimati',
    },
  });
  const platform = await actor(source.id, 'TENANT_ADMIN', true);
  const employee = await actor(source.id, 'EMPLOYEE');
  for (const [code, other] of [
    ['legacy_customers', 'legacy_orders'],
    ['legacy_orders', 'legacy_customers'],
  ]) {
    const published = schema(code, other);
    mutate?.(published, employee.memberId);
    await h.adminDatabase.objectDefinition.create({
      data: {
        id: published.object.id,
        tenantId: source.id,
        code,
        name: 'UNPUBLISHED draft name',
        titleFieldKey: 'name',
        status: 'ACTIVE',
        poolEnabled: code === 'legacy_customers',
        poolLifecycleEnabled: true,
        poolContactTtlHours: 12,
        poolFollowUpTtlHours: 240,
        poolProtectionRules:
          code === 'legacy_customers'
            ? [{ sourceObjectCode: 'legacy_orders', statusKeys: ['confirmed'] }]
            : [],
      },
    });
    await h.adminDatabase.objectPublication.create({
      data: {
        id: published.publication.id,
        tenantId: source.id,
        objectId: published.object.id,
        publicationNo: 1,
        sourceDraftVersion: 1,
        configuration: published as unknown as Prisma.InputJsonValue,
        changeSummary: [],
        publishedByMemberId: platform.memberId,
      },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: published.object.id },
      data: { activePublicationId: published.publication.id },
    });
  }
  const customer = await h.adminDatabase.objectDefinition.findFirstOrThrow({
    where: { tenantId: source.id, code: 'legacy_customers' },
  });
  await h.adminDatabase.record.create({
    data: {
      tenantId: source.id,
      objectId: customer.id,
      recordNo: 1n,
      title: 'Existing source business',
      data: { name: 'Existing source business' },
      createdByMemberId: platform.memberId,
    },
  });
  await h.adminDatabase.objectPermission.create({
    data: {
      tenantId: source.id,
      objectId: customer.id,
      subjectType: 'MEMBER',
      subjectMemberId: employee.memberId,
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'OWN',
    },
  });
  await h.adminDatabase.objectDefinition.create({
    data: {
      tenantId: source.id,
      code: 'unpublished',
      name: 'Excluded',
      titleFieldKey: 'name',
    },
  });
  await h.adminDatabase.workGoalRule.create({
    data: {
      tenantId: source.id,
      metric: 'calls',
      target: 20,
      remindAt: '17:00',
      weekdays: [1, 2, 3, 4, 5],
      audience: 'ALL_EMPLOYEES',
    },
  });
  await h.adminDatabase.workGoalRule.create({
    data: {
      tenantId: source.id,
      metric: 'tasksDone',
      target: 1,
      remindAt: '17:00',
      weekdays: [1],
      audience: 'SELECTED_MEMBERS',
    },
  });
  const created = response<TemplateDetail>(
    await api('post', '/platform/business-templates', platform.cookie, {
      code: 'flow-' + randomUUID(),
      name: 'Flow template',
      description: null,
    }).expect(201),
  );
  const path = '/platform/business-templates/' + created.id;
  return { source, target, platform, employee, template: created, path };
}
function draftConfiguration(
  configuration: Capture['configuration'],
): BusinessTemplateConfiguration {
  return {
    ...configuration,
    objects: configuration.objects.map((o) => {
      const { publishedCode: _code, ...object } = o;
      void _code;
      return {
        ...object,
        fields: o.fields.map((f) => {
          const { publishedFieldKey: _key, publishedType: _type, ...field } = f;
          void _key;
          void _type;
          return field;
        }),
      };
    }),
  };
}
async function captured(f: Awaited<ReturnType<typeof fixture>>) {
  return response<Capture>(
    await api('post', f.path + '/capture-preview', f.platform.cookie, {
      expectedVersion: 1,
      sourceTenantId: f.source.id,
    }).expect(200),
  );
}
async function apply(f: Awaited<ReturnType<typeof fixture>>) {
  const preview = await captured(f);
  const saved = response<TemplateDetail>(
    await api('put', f.path + '/draft', f.platform.cookie, {
      expectedVersion: 1,
      name: 'Flow template',
      description: null,
      configuration: draftConfiguration(preview.configuration),
    }).expect(200),
  );
  const version = response<BusinessTemplateVersion>(
    await api('post', f.path + '/versions', f.platform.cookie, {
      expectedVersion: saved.draftVersion,
    }).expect(201),
  );
  const body = { tenantId: f.target.id, templateVersionId: version.id };
  const result = response<TemplateApplicationResult>(
    await api('post', f.path + '/applications', f.platform.cookie, body).expect(
      201,
    ),
  );
  const repeated = response<TemplateApplicationResult>(
    await api('post', f.path + '/applications', f.platform.cookie, body).expect(
      201,
    ),
  );
  expect(repeated.id).toBe(result.id);
  return { preview, version, result };
}
function initBody(
  group: TemplateInitializationGroupDto,
): PublishTemplateInitializationDto {
  return {
    templateVersionId: group.templateVersionId,
    objects: group.objects.map((o) => ({
      id: o.id,
      expectedVersion: o.version,
      expectedPoolConfigVersion: o.poolConfigVersion,
    })),
  };
}
async function initialization(f: Awaited<ReturnType<typeof fixture>>) {
  const administrator = await actor(f.target.id, 'TENANT_ADMIN');
  const employee = await actor(f.target.id, 'EMPLOYEE');
  const path =
    '/workspaces/' +
    f.target.code +
    '/object-definitions/template-initialization';
  const list = response<TemplateInitializationResponseDto>(
    await api('get', path, administrator.cookie).expect(200),
  );
  return { administrator, employee, path, group: list.groups[0] };
}
describe('portable workflow templates (HTTP + PostgreSQL)', () => {
  beforeAll(async () => {
    // Dedicated local databases or the same ephemeral CI databases used by the critical fixture.
    const url = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? '');
    const local =
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '55433' &&
      url.pathname === '/crm_templates_api_1026' &&
      url.username === 'crm';
    const ci =
      process.env.CI === 'true' &&
      ['localhost', '127.0.0.1', 'postgres'].includes(url.hostname) &&
      url.port === '5432' &&
      url.pathname === '/crm' &&
      url.username === 'crm';
    const localTest =
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '5432' &&
      /^\/crm_[a-z0-9_]*_test_[0-9]+$/.test(url.pathname);
    if (!local && !localTest && !ci)
      throw new Error('Use isolated template API database');
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it.each(['count', 'disable', 'demote'])(
    'scopes sole-administrator %s protection to the current company',
    async (operation) => {
      const tenants = await Promise.all(
        [0, 1].map(() =>
          h.adminDatabase.tenant.create({
            data: {
              code: 'admin-scope-' + randomUUID(),
              name: 'Admin scope',
              status: 'ACTIVE',
              activatedAt: new Date(),
            },
          }),
        ),
      );
      const admin = await actor(tenants[0].id, 'TENANT_ADMIN');
      const otherMembership = await h.adminDatabase.tenantMember.create({
        data: {
          tenantId: tenants[1].id,
          userId: admin.userId,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      if (operation === 'count') {
        for (const tenant of tenants) {
          const page = response<{ total: number; activeAdminCount: number }>(
            await api(
              'get',
              '/workspaces/' + tenant.code + '/members',
              admin.cookie,
            ).expect(200),
          );
          expect(page).toMatchObject({ total: 1, activeAdminCount: 1 });
        }
        return;
      }
      const path =
        '/workspaces/' + tenants[0].code + '/members/' + admin.memberId;
      const result =
        operation === 'disable'
          ? await api('patch', path, admin.cookie, {
              status: 'DISABLED',
            }).expect(409)
          : await api('patch', path + '/role', admin.cookie, {
              role: 'EMPLOYEE',
            }).expect(409);
      expect(response<{ code: string }>(result).code).toBe(
        'TENANT_ADMIN_REQUIRED',
      );
      const members = await h.adminDatabase.tenantMember.findMany({
        where: { id: { in: [admin.memberId, otherMembership.id] } },
      });
      expect(members).toHaveLength(2);
      for (const member of members)
        expect(member).toMatchObject({
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        });
    },
  );
  it.each(['workflow', 'automations', 'pool', 'goalRules'])(
    'refuses saving a captured template with null %s',
    async (key) => {
      const f = await fixture();
      const configuration = draftConfiguration(
        (await captured(f)).configuration,
      );
      Object.assign(
        key === 'goalRules' ? configuration : configuration.objects[0],
        { [key]: null },
      );
      await api('put', f.path + '/draft', f.platform.cookie, {
        expectedVersion: 1,
        name: 'Invalid null extension',
        description: null,
        configuration,
      }).expect(400);
    },
  );
  it.each(['states', 'transitions'] as const)(
    'refuses publishing duplicate disabled workflow %s without creating a version',
    async (key) => {
      const f = await fixture();
      const configuration = draftConfiguration(
        (await captured(f)).configuration,
      );
      const workflow = configuration.objects[0].workflow!;
      workflow.isEnabled = false;
      configuration.objects[0].pool!.protectionRules = [];
      if (key === 'states') workflow.states.push({ ...workflow.states[0] });
      else workflow.transitions.push({ ...workflow.transitions[0] });
      const saved = response<TemplateDetail>(
        await api('put', f.path + '/draft', f.platform.cookie, {
          expectedVersion: 1,
          name: 'Incomplete disabled workflow',
          description: null,
          configuration,
        }).expect(200),
      );
      const blocked = await api(
        'post',
        f.path + '/versions',
        f.platform.cookie,
        {
          expectedVersion: saved.draftVersion,
        },
      ).expect(409);
      expect(response<{ code: string }>(blocked).code).toBe(
        'TEMPLATE_PUBLICATION_BLOCKED',
      );
      expect(
        await h.adminDatabase.businessTemplateVersion.count({
          where: { templateId: f.template.id },
        }),
      ).toBe(0);
    },
  );
  it('captures current published flows and live pools without writing or copying draft-only objects', async () => {
    const f = await fixture();
    const fingerprint = async () =>
      createHash('sha256')
        .update(
          JSON.stringify(
            await Promise.all([
              h.adminDatabase.objectDefinition.findMany({
                where: { tenantId: f.source.id },
                orderBy: { id: 'asc' },
              }),
              h.adminDatabase.objectPublication.findMany({
                where: { tenantId: f.source.id },
                orderBy: { id: 'asc' },
              }),
              h.adminDatabase.record.findMany({
                where: { tenantId: f.source.id },
                orderBy: { id: 'asc' },
              }),
            ]),
            (_key, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value,
          ),
        )
        .digest('hex');
    const before = await fingerprint();
    const preview = await captured(f);
    expect(preview.blocking).toEqual([]);
    expect(preview.excluded).toMatchObject({
      unpublishedObjects: 1,
      selectedGoalRules: 1,
      memberOverrides: 1,
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: '已排除 1 项指定员工目标。' }),
      ]),
    );
    expect(preview.configuration.objects[0]).toMatchObject({
      code: 'legacy_customers',
      name: 'legacy_customers',
      publishedCode: null,
      workflow: { isEnabled: true },
      pool: { contactTtlHours: 12 },
      automations: [{ key: 'create-linked' }],
    });
    expect(preview.configuration.goalRules).toEqual([
      {
        metric: 'calls',
        target: 20,
        remindAt: '17:00',
        weekdays: [1, 2, 3, 4, 5],
        audience: 'ALL_EMPLOYEES',
        enabled: true,
      },
    ]);
    expect(await fingerprint()).toBe(before);
    await api('post', f.path + '/capture-preview', f.employee.cookie, {
      expectedVersion: 1,
      sourceTenantId: f.source.id,
    }).expect(403);
    await api('post', f.path + '/capture-preview', f.platform.cookie, {
      expectedVersion: 99,
      sourceTenantId: f.source.id,
    }).expect(409);
  });
  it('preserves captured camelCase field keys and references through save, publish, apply and initialization', async () => {
    const f = await fixture((published) => {
      published.fields[0].fieldKey = 'contractNo';
      published.fields[1].fieldKey = 'signDate';
      published.object.titleFieldKey = 'contractNo';
      published.defaultView.columnFieldKeys = ['contractNo', 'signDate'];
      published.defaultView.searchFieldKeys = ['contractNo'];
      published.employeeAccess.fields = {
        contractNo: 'EDIT',
        signDate: 'EDIT',
      };
      published.workflow!.transitions[0].requiredFieldKeys = ['contractNo'];
      published.workflow!.transitions[0].actions = [
        {
          key: 'note',
          type: 'UPDATE_RECORD',
          target: 'SOURCE_RECORD',
          values: { signDate: { source: 'LITERAL', value: 'confirmed' } },
        },
      ];
      published.automations![0].mappings = {
        contractNo: { source: 'SOURCE_FIELD', fieldKey: 'contractNo' },
      };
    });
    await apply(f);
    const i = await initialization(f);
    await api('post', i.path, i.administrator.cookie, initBody(i.group)).expect(
      200,
    );
    const publications = await h.adminDatabase.objectPublication.findMany({
      where: { tenantId: f.target.id },
    });
    expect(publications).toHaveLength(2);
    for (const publication of publications) {
      expect(publication.configuration).toMatchObject({
        object: { titleFieldKey: 'contractNo' },
        fields: [{ fieldKey: 'contractNo' }, { fieldKey: 'signDate' }],
        defaultView: {
          columnFieldKeys: ['contractNo', 'signDate'],
          searchFieldKeys: ['contractNo'],
        },
        employeeAccess: { fields: { contractNo: 'EDIT', signDate: 'EDIT' } },
        workflow: {
          transitions: [
            {
              requiredFieldKeys: ['contractNo'],
              actions: [
                {
                  values: {
                    signDate: { source: 'LITERAL', value: 'confirmed' },
                  },
                },
              ],
            },
          ],
        },
        automations: [
          {
            mappings: {
              contractNo: { source: 'SOURCE_FIELD', fieldKey: 'contractNo' },
            },
          },
        ],
      });
    }
  });
  it('inherits into a memberless company then atomically publishes cyclic targets with real publisher audit', async () => {
    const f = await fixture();
    await apply(f);
    expect(
      await h.adminDatabase.tenantMember.count({
        where: { tenantId: f.target.id },
      }),
    ).toBe(0);
    const workflows = await h.adminDatabase.objectWorkflowDefinition.findMany({
      where: { tenantId: f.target.id },
      include: { transitions: true },
    });
    expect(workflows).toHaveLength(2);
    expect(
      await h.adminDatabase.record.count({ where: { tenantId: f.target.id } }),
    ).toBe(0);
    expect(workflows[0]).toMatchObject({
      createdByMemberId: null,
      updatedByMemberId: null,
      sourceTemplateVersionId: expect.any(String) as unknown,
    });
    expect(workflows[0].transitions[0].actions).toEqual([
      {
        key: 'note',
        type: 'UPDATE_RECORD',
        target: 'SOURCE_RECORD',
        values: { inquiry: { source: 'LITERAL', value: 'confirmed' } },
      },
    ]);
    const i = await initialization(f);
    await api('get', i.path, i.employee.cookie).expect(403);
    await api('post', i.path, i.administrator.cookie, initBody(i.group)).expect(
      200,
    );
    expect(
      await h.adminDatabase.objectPublication.count({
        where: {
          tenantId: f.target.id,
          publishedByMemberId: i.administrator.memberId,
        },
      }),
    ).toBe(2);
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.target.id,
          action: 'object.published',
          actorId: i.administrator.userId,
        },
      }),
    ).toBe(2);
    await api('post', i.path, i.administrator.cookie, initBody(i.group)).expect(
      409,
    );
    const goals = response<WorkGoalSettingsDto>(
      await api(
        'get',
        '/workspaces/' + f.target.code + '/work-goals/settings',
        i.administrator.cookie,
      ).expect(200),
    );
    expect(goals.timezone).toBe('Pacific/Kiritimati');
    expect(goals.rules[0]).toMatchObject({
      audience: 'ALL_EMPLOYEES',
      memberIds: [],
      version: 1,
      target: 20,
    });
    const runtime = '/workspaces/' + f.target.code + '/objects/';
    const customer = response<RecordResponseDto>(
      await api(
        'post',
        runtime + 'legacy_customers/records',
        i.administrator.cookie,
        { values: { name: 'Portable customer' }, ownerMemberId: null },
      ).expect(201),
    );
    const customerId = customer.id;
    const claimed = response<RecordOwnershipResponseDto>(
      await api(
        'post',
        runtime + 'legacy_customers/records/' + customerId + '/ownership',
        i.employee.cookie,
        { action: 'CLAIM', version: customer.version },
      ).expect(201),
    );
    const updated = response<RecordResponseDto>(
      await api(
        'patch',
        runtime + 'legacy_customers/records/' + customerId,
        i.employee.cookie,
        { version: claimed.version, values: { inquiry: 'Needs quotation' } },
      ).expect(200),
    );
    expect(updated.poolStage).not.toBe('PROTECTED');
    const followUpPath = '/workspaces/' + f.target.code + '/follow-ups';
    const followUp = response<FollowUpResponseDto>(
      await api('post', followUpPath, i.employee.cookie, {
        objectCode: 'legacy_customers',
        recordId: customerId,
        title: 'Confirm requirements',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
      }).expect(201),
    );
    await api('patch', followUpPath + '/' + followUp.id, i.employee.cookie, {
      version: followUp.version,
      status: 'DONE',
      completionResult: {
        activityType: 'CALL',
        content: 'Confirmed inquiry',
        outcome: 'CONNECTED',
      },
    }).expect(200);
    const following = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(following.poolStage).toBe('FOLLOWING');
    const order = response<AutomationExecution>(
      await api(
        'post',
        runtime +
          'legacy_customers/records/' +
          customerId +
          '/automations/create-linked/execute',
        i.employee.cookie,
        {
          expectedVersion: following.version,
          requestId: randomUUID(),
          inputs: {},
        },
      ).expect(201),
    );
    const targetId = order.targetRecordId;
    const beforeConfirm = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(beforeConfirm.poolStage).not.toBe('PROTECTED');
    const orderRecord = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: targetId },
    });
    await api(
      'post',
      runtime +
        'legacy_orders/records/' +
        targetId +
        '/workflow/transitions/confirm',
      i.employee.cookie,
      { expectedVersion: orderRecord.version },
    ).expect(201);
    const protectedCustomer = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(protectedCustomer.poolStage).toBe('PROTECTED');
  });
  it('rejects incomplete/duplicate/stale object or pool confirmations before any publication', async () => {
    const f = await fixture();
    await apply(f);
    const i = await initialization(f);
    const body = initBody(i.group);
    const sourceObject =
      await h.adminDatabase.objectDefinition.findFirstOrThrow({
        where: { tenantId: f.source.id, code: 'legacy_customers' },
      });
    for (const objects of [
      body.objects.slice(1),
      [body.objects[0], body.objects[0]],
      [{ ...body.objects[0], id: sourceObject.id }, body.objects[1]],
      body.objects.map((o) => ({ ...o, expectedVersion: 99 })),
      body.objects.map((o) => ({ ...o, expectedPoolConfigVersion: 99 })),
    ])
      await api('post', i.path, i.administrator.cookie, {
        ...body,
        objects,
      }).expect(409);
    await api('post', i.path, i.administrator.cookie, {
      ...body,
      templateVersionId: randomUUID(),
    }).expect(409);
    expect(
      await h.adminDatabase.objectPublication.count({
        where: { tenantId: f.target.id },
      }),
    ).toBe(0);
    const objectId = body.objects[0].id;
    await h.adminDatabase.objectDefinition.update({
      where: { id: objectId },
      data: { poolConfigVersion: { increment: 1 } },
    });
    await api('post', i.path, i.administrator.cookie, body).expect(409);
    expect(
      await h.adminDatabase.objectPublication.count({
        where: { tenantId: f.target.id },
      }),
    ).toBe(0);
  });
  it('rolls back every table when one pool protection reference is invalid', async () => {
    const f = await fixture();
    await apply(f);
    const i = await initialization(f);
    await h.adminDatabase.objectDefinition.update({
      where: { id: i.group.objects[0].id },
      data: {
        poolEnabled: true,
        poolLifecycleEnabled: true,
        poolProtectionRules: [
          { sourceObjectCode: 'missing', statusKeys: ['confirmed'] },
        ],
      },
    });
    await api('post', i.path, i.administrator.cookie, initBody(i.group)).expect(
      422,
    );
    expect(
      await h.adminDatabase.objectPublication.count({
        where: { tenantId: f.target.id },
      }),
    ).toBe(0);
    expect(
      await h.adminDatabase.objectDefinition.count({
        where: { tenantId: f.target.id, activePublicationId: { not: null } },
      }),
    ).toBe(0);
  });
  it('reuses published identities after draft removal and retains the template dashboard', async () => {
    const f = await fixture();
    const { preview, version } = await apply(f);
    const dashboard = {
      schemaVersion: 2 as const,
      title: 'Keep my workspace',
      widgets: [],
    };
    await api('put', f.path + '/draft', f.platform.cookie, {
      expectedVersion: 2,
      name: 'Flow',
      description: null,
      configuration: { schemaVersion: 1, objects: [], dashboard },
    }).expect(200);
    const recaptured = response<Capture>(
      await api('post', f.path + '/capture-preview', f.platform.cookie, {
        expectedVersion: 3,
        sourceTenantId: f.source.id,
      }).expect(200),
    );
    expect(recaptured.configuration.dashboard).toEqual(dashboard);
    expect(recaptured.configuration.objects.map((o) => o.id)).toEqual(
      preview.configuration.objects.map((o) => o.id),
    );
    expect(recaptured.configuration.objects[0]).toMatchObject({
      publishedCode: 'legacy_customers',
      fields: [
        {
          id: version.configuration.objects[0].fields[0].id,
          publishedFieldKey: 'name',
          publishedType: 'TEXT',
        },
        { publishedFieldKey: 'inquiry' },
      ],
    });
  });

  it('reports fixed ACTOR member bindings in preview and refuses saving them', async () => {
    const f = await fixture((configuration, memberId) => {
      if (configuration.object.code === 'legacy_customers')
        configuration.workflow!.transitions[0].actions = [
          {
            key: 'fixed-member',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { inquiry: { source: 'ACTOR', memberId } },
          },
        ];
    });
    const preview = await captured(f);
    expect(preview.blocking).toContainEqual(
      expect.objectContaining({
        code: 'TEMPLATE_MEMBER_BINDING_NOT_PORTABLE',
        path: expect.stringContaining('.memberId') as unknown,
      }),
    );
    await api('put', f.path + '/draft', f.platform.cookie, {
      expectedVersion: 1,
      name: 'Flow',
      description: null,
      configuration: draftConfiguration(preview.configuration),
    }).expect(400);
    expect(
      (
        await h.adminDatabase.businessTemplate.findUniqueOrThrow({
          where: { id: f.template.id },
        })
      ).draftVersion,
    ).toBe(1);
  });

  it('excludes every historical publication and any record including soft-deleted records', async () => {
    const f = await fixture();
    await apply(f);
    const i = await initialization(f);
    const body = initBody(i.group);
    const object = i.group.objects[0];
    await h.adminDatabase.record.create({
      data: {
        tenantId: f.target.id,
        objectId: object.id,
        recordNo: 1n,
        title: 'Soft deleted',
        data: {},
        deletedAt: new Date(),
      },
    });
    const remaining = response<TemplateInitializationResponseDto>(
      await api('get', i.path, i.administrator.cookie).expect(200),
    );
    expect(remaining.groups[0].objects).toHaveLength(1);
    await api('post', i.path, i.administrator.cookie, body).expect(409);
    const other = i.group.objects[1];
    const configuration = schema(other.code, 'legacy_customers');
    configuration.object.id = other.id;
    await h.adminDatabase.objectPublication.create({
      data: {
        id: configuration.publication.id,
        tenantId: f.target.id,
        objectId: other.id,
        publicationNo: 1,
        sourceDraftVersion: 1,
        configuration: configuration as unknown as Prisma.InputJsonValue,
        changeSummary: [],
        publishedByMemberId: i.administrator.memberId,
      },
    });
    expect(
      response<TemplateInitializationResponseDto>(
        await api('get', i.path, i.administrator.cookie).expect(200),
      ).groups,
    ).toEqual([]);
    await api('post', i.path, i.administrator.cookie, body).expect(409);
  });

  it('uses an existing active target snapshot while leaving its unpublished draft untouched', async () => {
    const f = await fixture();
    await apply(f);
    const i = await initialization(f);
    const order = i.group.objects.find((o) => o.code === 'legacy_orders')!;
    const configuration = schema(order.code, 'legacy_customers');
    configuration.object.id = order.id;
    await h.adminDatabase.objectPublication.create({
      data: {
        id: configuration.publication.id,
        tenantId: f.target.id,
        objectId: order.id,
        publicationNo: 1,
        sourceDraftVersion: 1,
        configuration: configuration as unknown as Prisma.InputJsonValue,
        changeSummary: [],
        publishedByMemberId: i.administrator.memberId,
      },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: order.id },
      data: {
        status: 'ACTIVE',
        activePublicationId: configuration.publication.id,
        settings: { automations: [{ invalid: 'unpublished draft' }] },
      },
    });
    const before = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: order.id },
    });
    const list = response<TemplateInitializationResponseDto>(
      await api('get', i.path, i.administrator.cookie).expect(200),
    );
    expect(list.groups[0].objects).toHaveLength(1);
    const body = initBody(list.groups[0]);
    const concurrent = await Promise.all([
      api('post', i.path, i.administrator.cookie, body),
      api('post', i.path, i.administrator.cookie, body),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await h.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: order.id },
      }),
    ).toEqual(before);
    expect(
      await h.adminDatabase.objectPublication.count({
        where: { tenantId: f.target.id },
      }),
    ).toBe(2);
  });

  it('treats goals as existing configuration in summary and apply without overwriting them', async () => {
    const f = await fixture();
    const { version } = await apply(f);
    const target = await h.adminDatabase.tenant.create({
      data: {
        code: 'goal-dst-' + randomUUID(),
        name: 'Already configured',
        status: 'ACTIVE',
      },
    });
    await h.adminDatabase.workGoalRule.create({
      data: {
        tenantId: target.id,
        metric: 'calls',
        target: 7,
        remindAt: '17:00',
        weekdays: [1],
        audience: 'ALL_EMPLOYEES',
      },
    });
    const summary = response<{ canApplyTemplate: boolean }>(
      await api(
        'get',
        '/platform/tenants/' + target.id + '/business-configuration',
        f.platform.cookie,
      ).expect(200),
    );
    expect(summary.canApplyTemplate).toBe(false);
    await api('post', f.path + '/applications', f.platform.cookie, {
      tenantId: target.id,
      templateVersionId: version.id,
    }).expect(409);
    expect(
      await h.adminDatabase.objectDefinition.count({
        where: { tenantId: target.id },
      }),
    ).toBe(0);
    expect(
      (
        await h.adminDatabase.workGoalRule.findFirstOrThrow({
          where: { tenantId: target.id },
        })
      ).target,
    ).toBe(7);
  });
});
