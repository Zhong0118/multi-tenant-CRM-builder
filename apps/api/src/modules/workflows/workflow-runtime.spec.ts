import { ApiException } from '../../common/errors/api.exception';
import type { PublishedAction } from '../actions/action.types';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type { DynamicRecord } from '../records/records.repository';
import {
  resolveExecutableTransition,
  runtimeWorkflowView,
  START_TRANSITION_KEY,
} from './workflow-runtime';

function schema(actions: PublishedAction[] = []): PublishedObjectSchema {
  return {
    publication: {
      id: 'publication-leads',
      number: 1,
      sourceDraftVersion: 4,
      publishedAt: '2026-08-21T10:00:00.000Z',
    },
    object: {
      id: 'object-leads',
      code: 'leads',
      name: '销售线索',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 10,
    },
    fields: [
      {
        id: 'field-name',
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 10,
        isSystem: false,
      },
      {
        id: 'field-amount',
        fieldKey: 'amount',
        label: '预计金额',
        type: 'MONEY',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 20,
        isSystem: false,
      },
    ],
    defaultView: {
      code: 'default',
      name: '全部',
      columnFieldKeys: ['name'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { name: 'EDIT', amount: 'EDIT' },
    },
    workflow: {
      initialStateKey: 'new',
      states: [
        { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
        { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'mark-won',
          label: '标记赢单',
          fromStateKey: 'new',
          toStateKey: 'won',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: ['amount'],
          actions,
        },
      ],
    },
  };
}

function access(
  overrides: Partial<EffectiveObjectAccess> = {},
): EffectiveObjectAccess {
  return {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    readScope: 'OWN',
    updateScope: 'OWN',
    fields: { name: 'EDIT', amount: 'EDIT' },
    ...overrides,
  };
}

function record(overrides: Partial<DynamicRecord> = {}): DynamicRecord {
  return {
    id: 'record-1',
    objectId: 'object-leads',
    recordNo: 1n,
    ownerMemberId: 'member-employee',
    workflowStateKey: 'new',
    title: '张三',
    values: { name: '张三', amount: '100.00' },
    version: 7,
    createdByMemberId: 'member-employee',
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

/**
 * §31 — the Effect Summary is asserted on the serialized body, because that is
 * the JSON a client receives and the exact byte string the leakage assertions
 * below scan.
 */
interface TransitionEffectBody {
  type: string;
  label: string;
}

function responseBody(view: object): {
  availableTransitions: Array<
    Record<string, unknown> & { effects?: TransitionEffectBody[] }
  >;
} {
  return JSON.parse(JSON.stringify(view)) as {
    availableTransitions: Array<
      Record<string, unknown> & { effects?: TransitionEffectBody[] }
    >;
  };
}

/**
 * One of every V1 Action type, each carrying exactly the internals §31 forbids
 * the Effect Summary from echoing: a hidden field key (`phone`), the mapping
 * sources (`SOURCE_FIELD` / `LITERAL` / `NOW_PLUS_DAYS` / `ACTION_OUTPUT`), a
 * mapped value (`200.00`), a follow-up title, the Target Object code
 * (`customers`) and the Action keys themselves.
 */
const LEAKY_ACTIONS: PublishedAction[] = [
  {
    key: 'create-customer',
    type: 'CREATE_RECORD',
    targetObjectCode: 'customers',
    values: { phone: { source: 'SOURCE_FIELD', fieldKey: 'phone' } },
    owner: { source: 'ACTOR' },
  },
  {
    key: 'set-amount',
    type: 'UPDATE_RECORD',
    target: 'SOURCE_RECORD',
    values: { amount: { source: 'LITERAL', value: '200.00' } },
  },
  {
    key: 'link-customer',
    type: 'CREATE_RELATION',
    left: { source: 'SOURCE_RECORD' },
    right: {
      source: 'ACTION_OUTPUT',
      actionKey: 'create-customer',
      property: 'recordId',
    },
  },
  {
    key: 'follow-up',
    type: 'CREATE_FOLLOW_UP',
    target: { source: 'SOURCE_RECORD' },
    title: { source: 'LITERAL', value: '首次回访' },
    dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
    assignee: { source: 'ACTOR' },
  },
  {
    key: 'take-ownership',
    type: 'ASSIGN_OWNER',
    target: 'SOURCE_RECORD',
    owner: { source: 'ACTOR' },
  },
];

describe('workflow runtime', () => {
  it('offers start for a legacy record with update access', () => {
    const view = runtimeWorkflowView({
      schema: schema(),
      access: access(),
      role: 'EMPLOYEE',
      record: record({ workflowStateKey: null }),
    });
    expect(view.currentState).toBeNull();
    expect(view.availableTransitions.map((item) => item.key)).toEqual([
      START_TRANSITION_KEY,
    ]);
  });

  it('describes every published action as a safe static effect (§31)', () => {
    const body = responseBody(
      runtimeWorkflowView({
        schema: schema(LEAKY_ACTIONS),
        access: access(),
        role: 'EMPLOYEE',
        record: record(),
      }),
    );

    expect(body.availableTransitions[0].effects).toEqual([
      { type: 'CREATE_RECORD', label: '创建 1 条记录' },
      { type: 'UPDATE_RECORD', label: '更新当前记录' },
      { type: 'CREATE_RELATION', label: '建立 1 条记录关联' },
      { type: 'CREATE_FOLLOW_UP', label: '创建 1 个待跟进事项' },
      { type: 'ASSIGN_OWNER', label: '将当前记录分配给执行人' },
    ]);
  });

  it('keeps field keys, mappings, values and object codes out of the effects (§31)', () => {
    const body = responseBody(
      runtimeWorkflowView({
        schema: schema(LEAKY_ACTIONS),
        access: access(),
        role: 'EMPLOYEE',
        record: record(),
      }),
    );
    const serialized = JSON.stringify(body.availableTransitions[0].effects);

    for (const secret of [
      'phone',
      'customers',
      'customer',
      '200.00',
      'SOURCE_FIELD',
      'SOURCE_RECORD',
      'LITERAL',
      'NOW_PLUS_DAYS',
      'ACTION_OUTPUT',
      'recordId',
      '首次回访',
      'name',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('lists an empty effect array for a transition without actions', () => {
    const body = responseBody(
      runtimeWorkflowView({
        schema: schema(),
        access: access(),
        role: 'EMPLOYEE',
        record: record(),
      }),
    );

    // Present-and-empty, never omitted: a consumer can always read `effects`.
    expect(body.availableTransitions[0]).toHaveProperty('effects');
    expect(body.availableTransitions[0].effects).toEqual([]);
  });

  it('lists no effects for the synthetic start transition', () => {
    const body = responseBody(
      runtimeWorkflowView({
        schema: schema(LEAKY_ACTIONS),
        access: access(),
        role: 'EMPLOYEE',
        record: record({ workflowStateKey: null }),
      }),
    );

    expect(body.availableTransitions.map((item) => item.key)).toEqual([
      START_TRANSITION_KEY,
    ]);
    expect(body.availableTransitions[0].effects).toEqual([]);
  });

  it('hides transitions when the member cannot update', () => {
    const view = runtimeWorkflowView({
      schema: schema(),
      access: access({ canUpdate: false, updateScope: 'NONE' }),
      role: 'EMPLOYEE',
      record: record(),
    });
    expect(view.availableTransitions).toEqual([]);
  });

  it('executes a valid transition', () => {
    expect(
      resolveExecutableTransition({
        schema: schema(),
        access: access(),
        role: 'EMPLOYEE',
        record: record(),
        transitionKey: 'mark-won',
      }),
    ).toMatchObject({
      key: 'mark-won',
      fromStateKey: 'new',
      toStateKey: 'won',
    });
  });

  it('resolves the published actions of the transition in array order', () => {
    const actions: PublishedAction[] = [
      {
        key: 'create-customer',
        type: 'CREATE_RECORD',
        targetObjectCode: 'customers',
        values: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
      },
      {
        key: 'take-ownership',
        type: 'ASSIGN_OWNER',
        target: 'SOURCE_RECORD',
        owner: { source: 'ACTOR' },
      },
    ];
    expect(
      resolveExecutableTransition({
        schema: schema(actions),
        access: access(),
        role: 'EMPLOYEE',
        record: record(),
        transitionKey: 'mark-won',
      }).actions,
    ).toEqual(actions);
  });

  it('resolves no actions for the synthetic start transition', () => {
    expect(
      resolveExecutableTransition({
        schema: schema([
          {
            key: 'set-amount',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { amount: { source: 'LITERAL', value: '200.00' } },
          },
        ]),
        access: access(),
        role: 'EMPLOYEE',
        record: record({ workflowStateKey: null }),
        transitionKey: START_TRANSITION_KEY,
      }).actions,
    ).toEqual([]);
  });

  it('rejects the wrong current state', () => {
    expect(() =>
      resolveExecutableTransition({
        schema: schema(),
        access: access(),
        role: 'EMPLOYEE',
        record: record({ workflowStateKey: 'won' }),
        transitionKey: 'mark-won',
      }),
    ).toThrow(ApiException);
  });

  it('rejects a missing required field', () => {
    try {
      resolveExecutableTransition({
        schema: schema(),
        access: access(),
        role: 'EMPLOYEE',
        record: record({ values: { name: '张三', amount: null } }),
        transitionKey: 'mark-won',
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).code).toBe(
        'WORKFLOW_REQUIRED_FIELDS_MISSING',
      );
    }
  });

  it('rejects a start on an already started record', () => {
    expect(() =>
      resolveExecutableTransition({
        schema: schema(),
        access: access(),
        role: 'EMPLOYEE',
        record: record(),
        transitionKey: START_TRANSITION_KEY,
      }),
    ).toThrow(ApiException);
  });
});
