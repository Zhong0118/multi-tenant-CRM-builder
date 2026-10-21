import {
  analyzeAutomationPublication,
  analyzeAutomationDependencies,
} from './automation-publication';
import type { AutomationRule } from './automation.types';
const rules: AutomationRule[] = [
  {
    key: 'order',
    label: '开单',
    enabled: true,
    allowedRoles: ['TENANT_ADMIN'],
    trigger: { type: 'MANUAL' },
    targetObjectCode: 'orders',
    owner: 'ACTOR',
    mappings: { name: { source: 'INPUT' } },
  },
];
const field = {
  fieldKey: 'name',
  type: 'TEXT' as const,
  required: true,
  defaultValue: null,
  config: {},
  isSystem: false,
};
const source = {
  object: { code: 'customers' },
  fields: [{ ...field, status: 'ACTIVE' as const }],
  employeeAccess: null,
};
describe('automation publication', () => {
  it('blocks an unavailable target before publication', () => {
    expect(
      analyzeAutomationPublication({ ...source, automations: rules } as never),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
        }),
      ]),
    );
  });
  it('accepts manually supplied required values', () => {
    expect(
      analyzeAutomationPublication({
        ...source,
        automations: rules,
        actionTargets: new Map([
          [
            'orders',
            {
              code: 'orders',
              status: 'ACTIVE',
              schema: { fields: [field], employeeAccess: null },
            },
          ],
        ]),
      } as never),
    ).toEqual([]);
  });
});

describe('automation target schema changes', () => {
  it('blocks retiring a target field referenced by another published table', () => {
    const activeSource = {
      object: { code: 'customers', status: 'ACTIVE' },
      activeSchema: {
        object: { code: 'customers' },
        fields: [field],
        automations: rules,
      },
    };
    const issues = analyzeAutomationDependencies(
      { object: { code: 'orders' }, fields: [], employeeAccess: null } as never,
      [activeSource] as never,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
        }),
      ]),
    );
  });
});

describe('fixed mapping compatibility', () => {
  it('rejects retired literal option keys and NOW into text', () => {
    const draft = {
      ...source,
      automations: [
        {
          ...rules[0],
          mappings: {
            name: { source: 'LITERAL', value: 'retired' },
            timestamp: { source: 'NOW' },
          },
        },
      ],
      actionTargets: new Map([
        [
          'orders',
          {
            code: 'orders',
            status: 'ACTIVE',
            schema: {
              fields: [
                {
                  ...field,
                  type: 'SINGLE_SELECT',
                  config: {
                    options: [{ key: 'active', label: '有效', isActive: true }],
                  },
                },
                { ...field, fieldKey: 'timestamp', required: false },
              ],
              employeeAccess: null,
            },
          },
        ],
      ]),
    };
    expect(analyzeAutomationPublication(draft as never)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
          fieldKey: 'name',
        }),
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_FIELD_TYPE_MISMATCH',
          fieldKey: 'timestamp',
        }),
      ]),
    );
  });
});

describe('automation static field validation', () => {
  const access = {
    canRead: true,
    canCreate: true,
    canUpdate: true,
    readScope: 'ALL',
    updateScope: 'ALL',
    fields: { name: 'EDIT', assignee: 'EDIT' },
  };
  const analyze = (
    rule: AutomationRule,
    targetFields = [field],
    sourceFields = source.fields,
  ) =>
    analyzeAutomationPublication({
      ...source,
      fields: sourceFields,
      employeeAccess: access,
      automations: [rule],
      actionTargets: new Map([
        [
          'orders',
          {
            code: 'orders',
            status: 'ACTIVE',
            schema: { fields: targetFields, employeeAccess: access },
          },
        ],
      ]),
    } as never);
  it('rejects employee MEMBER input while allowing administrator input', () => {
    const targetFields = [
      field,
      { ...field, fieldKey: 'assignee', type: 'MEMBER', required: false },
    ] as (typeof field)[];
    const rule: AutomationRule = {
      ...rules[0],
      mappings: { ...rules[0].mappings, assignee: { source: 'INPUT' } },
    };
    expect(analyze(rule, targetFields)).toEqual([]);
    expect(
      analyze({ ...rule, allowedRoles: ['EMPLOYEE'] }, targetFields),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
          fieldKey: 'assignee',
          message: expect.stringContaining('来源字段') as unknown,
        }),
      ]),
    );
  });
  it.each(['retired', 'missing', 42])(
    'rejects unavailable or mistyped trigger value %s',
    (equals) => {
      const sourceFields = [
        {
          ...field,
          status: 'ACTIVE',
          type: 'SINGLE_SELECT',
          config: {
            options: [
              { key: 'open', label: '进行中', status: 'ACTIVE' },
              { key: 'retired', label: '停用', status: 'INACTIVE' },
            ],
          },
        },
      ] as unknown as typeof source.fields;
      const rule: AutomationRule = {
        ...rules[0],
        trigger: { type: 'FIELD_CHANGED', fieldKey: 'name', equals },
        mappings: { name: { source: 'LITERAL', value: 'Order' } },
      };
      expect(analyze(rule, [field], sourceFields)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'VALIDATION_FAILED',
            fieldKey: 'name',
          }),
        ]),
      );
      expect(
        analyze(
          {
            ...rule,
            trigger: {
              type: 'FIELD_CHANGED',
              fieldKey: 'name',
              equals: 'open',
            },
          },
          [field],
          sourceFields,
        ),
      ).toEqual([]);
    },
  );
  it.each([null, 7, ''])('rejects invalid required literal %s', (value) => {
    expect(
      analyze({
        ...rules[0],
        mappings: { name: { source: 'LITERAL', value } },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
          fieldKey: 'name',
        }),
      ]),
    );
  });
  it('blocks target validation tightening that invalidates a published literal', () => {
    const issues = analyzeAutomationDependencies(
      {
        object: { code: 'orders' },
        fields: [{ ...field, status: 'ACTIVE', validation: { maxLength: 3 } }],
        employeeAccess: null,
      } as never,
      [
        {
          object: { code: 'customers', status: 'ACTIVE' },
          activeSchema: {
            ...source,
            automations: [
              {
                ...rules[0],
                mappings: { name: { source: 'LITERAL', value: 'Order title' } },
              },
            ],
          },
        },
      ] as never,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
          fieldKey: 'name',
        }),
      ]),
    );
  });
});
