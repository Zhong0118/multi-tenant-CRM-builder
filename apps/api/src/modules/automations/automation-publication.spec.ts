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
