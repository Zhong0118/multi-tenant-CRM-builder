import {
  analyzeTemplatePublication,
  checksumTemplateConfiguration,
  compileTemplateVersion,
  type BusinessTemplateConfiguration,
} from './business-template-publication.policy';
import type { DashboardDefinitionV2 } from '../dashboards/dashboard.types';

function validTemplate(): BusinessTemplateConfiguration {
  return {
    schemaVersion: 1,
    objects: [
      {
        id: 'template-object-lead',
        code: 'leads',
        name: '销售线索',
        description: null,
        icon: 'contacts',
        titleFieldKey: 'name',
        sortOrder: 10,
        status: 'ACTIVE',
        fields: [
          {
            id: 'template-field-lead-name',
            fieldKey: 'name',
            label: '姓名',
            type: 'TEXT',
            required: true,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 10,
            isSystem: false,
            status: 'ACTIVE',
          },
          {
            id: 'template-field-lead-phone',
            fieldKey: 'phone',
            label: '手机号',
            type: 'PHONE',
            required: false,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 20,
            isSystem: false,
            status: 'ACTIVE',
          },
        ],
        defaultView: {
          code: 'default',
          name: '全部线索',
          columnFieldKeys: ['name', 'phone'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        employeeAccess: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'ALL',
          updateScope: 'OWN',
          fields: { name: 'EDIT', phone: 'READ_ONLY' },
        },
      },
      {
        id: 'template-object-company',
        code: 'companies',
        name: '客户公司',
        description: null,
        icon: 'building',
        titleFieldKey: 'name',
        sortOrder: 20,
        status: 'ACTIVE',
        fields: [
          {
            id: 'template-field-company-name',
            fieldKey: 'name',
            label: '公司名称',
            type: 'TEXT',
            required: true,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 10,
            isSystem: false,
            status: 'ACTIVE',
          },
          {
            id: 'template-field-company-email',
            fieldKey: 'email',
            label: '邮箱',
            type: 'EMAIL',
            required: false,
            defaultValue: null,
            validation: {},
            config: {},
            sortOrder: 20,
            isSystem: false,
            status: 'ACTIVE',
          },
        ],
        defaultView: {
          code: 'default',
          name: '全部公司',
          columnFieldKeys: ['name', 'email'],
          sort: { field: 'updatedAt', direction: 'desc' },
        },
        employeeAccess: {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          readScope: 'ALL',
          updateScope: 'OWN',
          fields: { name: 'EDIT', email: 'READ_ONLY' },
        },
      },
    ],
  };
}

describe('template member defaults', () => {
  it('refuses company-specific member defaults in reusable templates', () => {
    const input = validTemplate();
    const field = input.objects[0].fields[1];
    field.type = 'MEMBER';
    field.defaultValue = '018f47a2-4b5c-7d8e-9f01-23456789abcd';

    expect(analyzeTemplatePublication(input, null).blocking).toContainEqual({
      code: 'TEMPLATE_MEMBER_DEFAULT_NOT_PORTABLE',
      message: expect.any(String) as unknown,
      objectId: input.objects[0].id,
      fieldKey: field.fieldKey,
    });
  });

  it('allows member fields with no default', () => {
    const input = validTemplate();
    input.objects[0].fields[1].type = 'MEMBER';

    expect(analyzeTemplatePublication(input, null).blocking).toEqual([]);
  });
});

describe('business template publication policy', () => {
  it('keeps templates without a dashboard compatible when compiling', () => {
    const compiled = compileTemplateVersion(validTemplate());

    expect(
      (compiled as DashboardTemplateConfiguration).dashboard,
    ).toBeUndefined();
    expect(compiled.schemaVersion).toBe(1);
  });

  it('includes a normalized valid dashboard preset in the compiled checksum', () => {
    const input = withDashboard(validTemplate(), dashboardPreset(10));
    const compiled = compileTemplateVersion(input);

    expect((compiled as DashboardTemplateConfiguration).dashboard).toEqual(
      dashboardPreset(0),
    );
    expect(checksumTemplateConfiguration(compiled)).not.toBe(
      checksumTemplateConfiguration(validTemplate()),
    );
  });

  it('keeps the checksum stable when dashboard widgets arrive in a different order', () => {
    const metric = {
      id: 'lead-count',
      type: 'METRIC' as const,
      title: '线索总数',
      audience: 'ALL' as const,
      objectCode: 'leads',
      width: 'QUARTER' as const,
      sortOrder: 0,
      filters: [],
      aggregation: 'COUNT' as const,
    };
    const list = dashboardPreset(1).widgets[0];
    const first = withDashboard(validTemplate(), {
      schemaVersion: 2,
      title: '销售总览',
      widgets: [metric, list],
    });
    const reordered = structuredClone(first);
    reordered.dashboard!.widgets.reverse();

    expect(checksumTemplateConfiguration(first)).toBe(
      checksumTemplateConfiguration(reordered),
    );
  });

  it('blocks dashboard field references with the dashboard widget path', () => {
    const dashboard = dashboardPreset(0);
    const widget = dashboard.widgets[0];
    if (!widget || widget.type !== 'RECORD_LIST') {
      throw new Error('dashboard fixture must contain a record list');
    }
    const input = withDashboard(validTemplate(), {
      ...dashboard,
      widgets: [
        {
          ...widget,
          fieldKeys: ['missing'],
        },
      ],
    });

    expect(analyzeTemplatePublication(input, null).blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FIELD_NOT_FOUND',
          path: 'dashboard.widgets[0].fieldKeys[0]',
        }),
      ]),
    );
  });

  it('publishes a complete two-object template as a stable aggregate', () => {
    const analysis = analyzeTemplatePublication(validTemplate(), null);

    expect(analysis.blocking).toEqual([]);
    expect(analysis.objectCount).toBe(2);
    expect(analysis.fieldCount).toBe(4);
  });

  it('blocks duplicate active object codes', () => {
    const input = validTemplate();
    input.objects[1].code = input.objects[0].code;

    expect(analyzeTemplatePublication(input, null).blocking).toContainEqual({
      code: 'TEMPLATE_OBJECT_CODE_DUPLICATE',
      message: '业务对象代码在模板内必须唯一。',
      objectId: input.objects[1].id,
    });
  });

  it.each([
    {
      name: 'template object ids',
      mutate: (input: BusinessTemplateConfiguration) => {
        input.objects[1].id = input.objects[0].id;
      },
      expected: {
        code: 'TEMPLATE_OBJECT_ID_DUPLICATE',
        message: '业务对象 ID 在模板内必须唯一。',
        objectId: 'template-object-lead',
      },
    },
    {
      name: 'field ids within an object',
      mutate: (input: BusinessTemplateConfiguration) => {
        input.objects[0].fields[1].id = input.objects[0].fields[0].id;
      },
      expected: {
        code: 'TEMPLATE_FIELD_ID_DUPLICATE',
        message: '字段 ID 在业务对象内必须唯一。',
        objectId: 'template-object-lead',
        fieldKey: 'phone',
      },
    },
    {
      name: 'field keys within an object',
      mutate: (input: BusinessTemplateConfiguration) => {
        input.objects[0].fields[1].fieldKey =
          input.objects[0].fields[0].fieldKey;
      },
      expected: {
        code: 'TEMPLATE_FIELD_KEY_DUPLICATE',
        message: '字段键在业务对象内必须唯一。',
        objectId: 'template-object-lead',
        fieldKey: 'name',
      },
    },
  ])('blocks duplicate $name', ({ mutate, expected }) => {
    const input = validTemplate();
    mutate(input);

    expect(analyzeTemplatePublication(input, null).blocking).toContainEqual(
      expected,
    );
  });

  it('locks published field keys and types', () => {
    const previous = validTemplate();
    const current = structuredClone(previous);
    current.objects[0].fields[0].type = 'NUMBER';

    expect(
      analyzeTemplatePublication(current, previous).blocking,
    ).toContainEqual({
      code: 'TEMPLATE_FIELD_IDENTITY_LOCKED',
      message: '已发布字段的字段键和类型不能修改。',
      objectId: current.objects[0].id,
      fieldKey: 'name',
    });
  });

  it('locks identities from an older version after the active version inactivated them', () => {
    const firstVersion = validTemplate();
    const activeVersion = structuredClone(firstVersion);
    activeVersion.objects = activeVersion.objects.slice(1);
    const restored = structuredClone(firstVersion);
    restored.objects[0].code = 'renamed-leads';
    restored.objects[0].fields[0].fieldKey = 'renamed-name';

    expect(
      analyzeTemplatePublication(restored, activeVersion, [
        firstVersion,
        activeVersion,
      ]).blocking,
    ).toEqual(
      expect.arrayContaining([
        {
          code: 'TEMPLATE_OBJECT_IDENTITY_LOCKED',
          message: '已发布对象的业务对象代码不能修改。',
          objectId: restored.objects[0].id,
        },
        {
          code: 'TEMPLATE_FIELD_IDENTITY_LOCKED',
          message: '已发布字段的字段键和类型不能修改。',
          objectId: restored.objects[0].id,
          fieldKey: 'renamed-name',
        },
      ]),
    );
  });
});

type DashboardTemplateConfiguration = BusinessTemplateConfiguration & {
  dashboard?: DashboardDefinitionV2;
};

function withDashboard(
  configuration: BusinessTemplateConfiguration,
  dashboard: DashboardDefinitionV2,
): DashboardTemplateConfiguration {
  return { ...configuration, dashboard };
}

function dashboardPreset(sortOrder: number): DashboardDefinitionV2 {
  return {
    schemaVersion: 2,
    title: '销售总览',
    widgets: [
      {
        id: 'lead-list',
        type: 'RECORD_LIST',
        title: '最新线索',
        audience: 'ALL',
        objectCode: 'leads',
        width: 'FULL',
        sortOrder,
        filters: [],
        fieldKeys: ['name', 'phone'],
        sort: { field: 'updatedAt', direction: 'DESC' },
        limit: 8,
      },
    ],
  };
}

it('retains published select options when analyzing a template through the shared publication policy', () => {
  const previous = validTemplate();
  previous.objects[0].fields[1].type = 'SINGLE_SELECT';
  previous.objects[0].fields[1].config = {
    options: [
      { key: 'new', label: 'New', status: 'ACTIVE' },
      { key: 'old', label: 'Old', status: 'ACTIVE' },
    ],
  };
  const input = structuredClone(previous);
  input.objects[0].fields[1].config = {
    options: [{ key: 'new', label: 'New', status: 'ACTIVE' }],
  };
  expect(analyzeTemplatePublication(input, previous).blocking).toContainEqual(
    expect.objectContaining({
      code: 'FIELD_OPTION_REMOVED',
      fieldKey: 'phone',
    }),
  );
});

describe('portable workflow template extensions', () => {
  const extended = () => {
    const input = validTemplate() as BusinessTemplateConfiguration & {
      goalRules: unknown[];
    };
    Object.assign(input.objects[0], {
      workflow: {
        isEnabled: true,
        initialStateKey: 'new',
        states: [
          { key: 'new', label: '新建', sortOrder: 0, isTerminal: false },
          { key: 'done', label: '完成', sortOrder: 10, isTerminal: true },
        ],
        transitions: [
          {
            key: 'finish',
            label: '完成',
            fromStateKey: 'new',
            toStateKey: 'done',
            allowedRoles: ['TENANT_ADMIN'],
            requiredFieldKeys: [],
            sortOrder: 0,
            actions: [],
          },
        ],
      },
      automations: [
        {
          key: 'create-company',
          label: '建公司',
          enabled: true,
          allowedRoles: ['TENANT_ADMIN'],
          trigger: { type: 'MANUAL' },
          targetObjectCode: 'companies',
          owner: 'ACTOR',
          mappings: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
        },
      ],
      pool: {
        enabled: true,
        lifecycleEnabled: true,
        ownershipTtlHours: null,
        protectionRules: [{ sourceObjectCode: 'leads', statusKeys: ['done'] }],
      },
    });
    input.goalRules = [
      {
        metric: 'calls',
        target: 20,
        remindAt: '17:00',
        weekdays: [1, 2, 3, 4, 5],
        audience: 'ALL_EMPLOYEES',
        enabled: true,
      },
    ];
    return input;
  };
  it('compiles every extension without inserting absent optional properties into legacy configurations', () => {
    const input = extended();
    const result = compileTemplateVersion(input);
    expect(result.objects[0]).toMatchObject({
      workflow: { transitions: [{ actions: [] }] },
      automations: [{ key: 'create-company' }],
      pool: { enabled: true },
    });
    expect(result).toHaveProperty('goalRules', input.goalRules);
    expect(compileTemplateVersion(validTemplate())).not.toHaveProperty(
      'goalRules',
    );
    expect(
      compileTemplateVersion(validTemplate()).objects[0],
    ).not.toHaveProperty('workflow');
  });
  it('includes goals in checksums and extension changes in publication summaries', () => {
    const input = extended();
    const previous = structuredClone(input);
    input.goalRules[0] = { ...input.goalRules[0], target: 25 };
    expect(checksumTemplateConfiguration(input)).not.toEqual(
      checksumTemplateConfiguration(previous),
    );
    expect(
      analyzeTemplatePublication(input, previous).changes.length,
    ).toBeGreaterThan(0);
    expect(
      analyzeTemplatePublication(input, validTemplate()).changes,
    ).toContainEqual(
      expect.objectContaining({
        objectId: 'template-object-lead',
        entity: 'OBJECT',
        kind: 'UPDATED',
      }),
    );
  });
  it('blocks missing cross-object workflow and pool state references', () => {
    const input = extended();
    const object = input.objects[0] as unknown as {
      automations: Array<{ targetObjectCode: string }>;
      pool: { protectionRules: Array<{ statusKeys: string[] }> };
    };
    object.automations[0].targetObjectCode = 'missing';
    object.pool.protectionRules[0].statusKeys = ['missing'];
    const analysis = analyzeTemplatePublication(input, null);
    expect(analysis.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
        }),
        expect.objectContaining({ code: 'POOL_PROTECTION_SOURCE_INVALID' }),
      ]),
    );
  });
  it.each(['ACTOR', 'LITERAL', 'TRIGGER'])(
    'blocks fixed members in %s, including disabled automations',
    (source) => {
      const input = extended();
      input.objects[1].fields[1].type = 'MEMBER';
      input.objects[0].fields[1].type = 'MEMBER';
      const object = input.objects[0] as unknown as {
        workflow: { transitions: Array<{ actions: unknown[] }> };
        automations: Array<{
          enabled: boolean;
          mappings: object;
          trigger: object;
        }>;
      };
      object.automations[0].enabled = false;
      if (source === 'TRIGGER')
        object.automations[0].trigger = {
          type: 'FIELD_CHANGED',
          fieldKey: 'phone',
          equals: 'member-id',
        };
      if (source === 'LITERAL')
        object.automations[0].mappings = {
          email: { source: 'LITERAL', value: 'member-id' },
        };
      if (source === 'ACTOR')
        object.workflow.transitions[0].actions = [
          {
            key: 'update',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { phone: { source: 'ACTOR', memberId: 'member-id' } },
          },
        ];
      expect(analyzeTemplatePublication(input, null).blocking).toContainEqual(
        expect.objectContaining({
          code: 'TEMPLATE_MEMBER_BINDING_NOT_PORTABLE',
          path: expect.any(String) as unknown,
        }),
      );
    },
  );
});
