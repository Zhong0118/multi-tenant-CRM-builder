import { ApiException } from '../../common/errors/api.exception';
import type { PublishedAction } from '../actions/action.types';
import {
  resolveEffectiveAccess,
  type EffectiveObjectAccess,
} from '../objects/effective-access';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type { DynamicRecord } from '../records/records.repository';
import {
  resolveExecutableTransition,
  runtimeWorkflowView,
  START_TRANSITION_KEY,
} from './workflow-runtime';
import type {
  PublishedWorkflow,
  PublishedWorkflowTransition,
} from './workflow.types';

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

/**
 * The literal label of the field the employee cannot see. It is a distinctive
 * Chinese string on purpose: the leakage assertions below scan the serialized
 * response/error for it, so a leak cannot hide behind an English substring that
 * also occurs inside a key such as `legacy-secret`.
 */
const HIDDEN_FIELD_LABEL = '内部评级';

function configuredTransition(
  key: string,
  label: string,
  requiredFieldKeys: string[],
): PublishedWorkflowTransition {
  return {
    key,
    label,
    fromStateKey: 'new',
    toStateKey: 'won',
    allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
    requiredFieldKeys,
    actions: [],
  };
}

/**
 * §4–§8 of the hardening design: one Transition per visibility case, all leaving
 * the same `new` state, so a single GET / POST pair can prove which ones the
 * Actor is allowed to see.
 *
 * - `visible-transition` requires `amount`, which the employee has as EDIT;
 * - `hidden-transition` requires `secret`, which the employee has as HIDDEN;
 * - `legacy-transition` requires `legacy-secret`, a key that is not a published
 *   field at all and therefore absent from `access.fields`;
 * - `prototype-transition` requires `constructor`, which is absent from
 *   `access.fields` but present on the prototype chain — the case an `??`-based
 *   membership test gets wrong;
 * - `empty-transition` requires nothing, which must stay available.
 */
function visibilitySchema(): PublishedObjectSchema {
  const base = schema();
  const workflow: PublishedWorkflow = {
    initialStateKey: 'new',
    states: [
      { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
    ],
    transitions: [
      configuredTransition('visible-transition', '推进可见', ['amount']),
      configuredTransition('hidden-transition', '推进隐藏', ['secret']),
      configuredTransition('legacy-transition', '推进遗留', ['legacy-secret']),
      configuredTransition('prototype-transition', '推进原型', ['constructor']),
      configuredTransition('empty-transition', '推进空必填', []),
    ],
  };
  return {
    ...base,
    fields: [
      ...base.fields,
      {
        id: 'field-secret',
        fieldKey: 'secret',
        label: HIDDEN_FIELD_LABEL,
        type: 'TEXT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 30,
        isSystem: false,
      },
    ],
    workflow,
  };
}

/** The employee's effective access: `amount` EDIT, `secret` HIDDEN, no `legacy-secret` entry. */
function employeeVisibilityAccess(): EffectiveObjectAccess {
  return access({
    updateScope: 'ALL',
    fields: { name: 'EDIT', amount: 'EDIT', secret: 'HIDDEN' },
  });
}

/** `record()` with a value for every required field of `visibilitySchema()`. */
function visibilityRecord(
  overrides: Partial<DynamicRecord> = {},
): DynamicRecord {
  return record({
    values: { name: '张三', amount: '100.00', secret: 'A' },
    ...overrides,
  });
}

function executeVisibilityTransition(input: {
  schema: PublishedObjectSchema;
  access: EffectiveObjectAccess;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
  record: DynamicRecord;
  transitionKey: string;
}): ApiException {
  try {
    resolveExecutableTransition(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    return error as ApiException;
  }
  throw new Error('expected the transition to be refused');
}

/**
 * §6: the wire body an `ApiException` becomes, built from the same three fields
 * the API's error envelope exposes. Scanning this string is the leakage check.
 */
function errorBody(exception: ApiException): string {
  return JSON.stringify({
    status: exception.getStatus(),
    code: exception.code,
    message: exception.message,
    fieldErrors: exception.fieldErrors,
  });
}

describe('workflow runtime required field visibility (§4–§8)', () => {
  it('omits a whole transition whose required field is HIDDEN, without leaking key or label (§5)', () => {
    const view = runtimeWorkflowView({
      schema: visibilitySchema(),
      access: employeeVisibilityAccess(),
      role: 'EMPLOYEE',
      record: visibilityRecord(),
    });
    const keys = view.availableTransitions.map((item) => item.key);

    // The visible Transition keeps today's behaviour: it is still offered, and
    // the client still receives the visible required key so it can pre-fill.
    expect(keys).toContain('visible-transition');
    expect(
      view.availableTransitions.find(
        (item) => item.key === 'visible-transition',
      )?.requiredFieldKeys,
    ).toEqual(['amount']);

    // §4: the Transition is unavailable as a whole — not returned with the
    // hidden key stripped out of `requiredFieldKeys`.
    expect(keys).not.toContain('hidden-transition');

    const body = JSON.stringify(view);
    expect(body).not.toContain('"secret"');
  });

  it('refuses a direct execute of a HIDDEN required field with a generic 403 (§6)', () => {
    const exception = executeVisibilityTransition({
      schema: visibilitySchema(),
      access: employeeVisibilityAccess(),
      role: 'EMPLOYEE',
      record: visibilityRecord(),
      transitionKey: 'hidden-transition',
    });

    expect(exception.code).toBe('WORKFLOW_TRANSITION_FORBIDDEN');
    expect(exception.getStatus()).toBe(403);
    expect(exception.message).toBe('你无权执行该流程动作。');
    expect(exception.fieldErrors).toEqual({});

    const body = errorBody(exception);
    expect(body).not.toContain('secret');
    expect(body).not.toContain(HIDDEN_FIELD_LABEL);
    // No hidden-field count and no new reason-bearing error code either.
    expect(body).not.toContain('WORKFLOW_REQUIRED_FIELDS_MISSING');
  });

  it('treats a required key missing from access.fields as HIDDEN (§8)', () => {
    const view = runtimeWorkflowView({
      schema: visibilitySchema(),
      access: employeeVisibilityAccess(),
      role: 'EMPLOYEE',
      record: visibilityRecord(),
    });
    const keys = view.availableTransitions.map((item) => item.key);

    expect(keys).not.toContain('legacy-transition');
    expect(JSON.stringify(view)).not.toContain('legacy-secret');

    const exception = executeVisibilityTransition({
      schema: visibilitySchema(),
      access: employeeVisibilityAccess(),
      role: 'EMPLOYEE',
      record: visibilityRecord(),
      transitionKey: 'legacy-transition',
    });
    expect(exception.code).toBe('WORKFLOW_TRANSITION_FORBIDDEN');
    expect(exception.getStatus()).toBe(403);
    expect(errorBody(exception)).not.toContain('legacy-secret');
  });

  it('treats a required prototype name absent from access.fields as HIDDEN (§8)', () => {
    // `constructor` is not an own entry of `access.fields`, but the object
    // literal inherits `Object.prototype.constructor`, so a membership test
    // written with `??` sees a value instead of `undefined` and judges this
    // required key VISIBLE. §8 says an absent key is HIDDEN, unconditionally.
    const employeeAccess = employeeVisibilityAccess();
    expect(Object.hasOwn(employeeAccess.fields, 'constructor')).toBe(false);
    expect(employeeAccess.fields['constructor']).toBeDefined();

    const view = runtimeWorkflowView({
      schema: visibilitySchema(),
      access: employeeAccess,
      role: 'EMPLOYEE',
      record: visibilityRecord(),
    });
    const keys = view.availableTransitions.map((item) => item.key);

    expect(keys).toContain('empty-transition');
    expect(keys).not.toContain('prototype-transition');
    expect(JSON.stringify(view)).not.toContain('constructor');

    const exception = executeVisibilityTransition({
      schema: visibilitySchema(),
      access: employeeAccess,
      role: 'EMPLOYEE',
      record: visibilityRecord(),
      transitionKey: 'prototype-transition',
    });
    expect(exception.code).toBe('WORKFLOW_TRANSITION_FORBIDDEN');
    expect(exception.getStatus()).toBe(403);
    expect(errorBody(exception)).not.toContain('constructor');
  });

  it('still offers and executes a transition that requires no field at all (§7)', () => {
    const input = {
      schema: visibilitySchema(),
      access: employeeVisibilityAccess(),
      role: 'EMPLOYEE' as const,
      record: visibilityRecord(),
    };

    // An empty required list must not be filtered out: the predicate is a
    // `.some()`, so "no required fields" stays available exactly as before.
    expect(
      runtimeWorkflowView(input).availableTransitions.map((item) => item.key),
    ).toContain('empty-transition');

    expect(
      resolveExecutableTransition({
        ...input,
        transitionKey: 'empty-transition',
      }),
    ).toMatchObject({
      key: 'empty-transition',
      fromStateKey: 'new',
      toStateKey: 'won',
    });
  });

  it('treats a READ_ONLY required field as visible, with its normal missing-value error (§7)', () => {
    const readOnlyAccess = access({
      updateScope: 'ALL',
      fields: { name: 'EDIT', amount: 'READ_ONLY', secret: 'HIDDEN' },
    });
    expect(readOnlyAccess.fields.amount).toBe('READ_ONLY');
    const input = {
      schema: visibilitySchema(),
      access: readOnlyAccess,
      role: 'EMPLOYEE' as const,
      // `amount` is READ_ONLY for this Actor and its record value is absent.
      record: visibilityRecord({ values: { name: '张三', secret: 'A' } }),
    };

    // §7: READ_ONLY counts as visible, so the Transition is still offered...
    expect(
      runtimeWorkflowView(input).availableTransitions.map((item) => item.key),
    ).toContain('visible-transition');

    // ...and direct execute still reports the ordinary, actionable field error.
    const exception = executeVisibilityTransition({
      ...input,
      transitionKey: 'visible-transition',
    });
    expect(exception.code).toBe('WORKFLOW_REQUIRED_FIELDS_MISSING');
    expect(exception.getStatus()).toBe(400);
    expect(Object.keys(exception.fieldErrors)).toEqual(['amount']);
  });

  it('keeps the missing-value error for a visible required field (§7)', () => {
    const input = {
      schema: schema(),
      access: access(),
      role: 'EMPLOYEE' as const,
      record: record({ values: { name: '张三', amount: null } }),
    };

    // `amount` is EDIT for this Actor, so the Transition is still offered...
    expect(
      runtimeWorkflowView(input).availableTransitions.map((item) => item.key),
    ).toContain('mark-won');

    // ...and direct execute still reports the normal, actionable field error.
    const exception = executeVisibilityTransition({
      ...input,
      transitionKey: 'mark-won',
    });
    expect(exception.code).toBe('WORKFLOW_REQUIRED_FIELDS_MISSING');
    expect(exception.getStatus()).toBe(400);
    expect(Object.keys(exception.fieldErrors)).toEqual(['amount']);
    expect(exception.message).toContain('预计金额');
  });

  it('does not regress a tenant admin whose fields are all editable (§13)', () => {
    const adminSchema = visibilitySchema();
    const adminAccess = resolveEffectiveAccess({
      schema: adminSchema,
      role: 'TENANT_ADMIN',
    });
    expect(adminAccess.fields.secret).toBe('EDIT');

    const keys = runtimeWorkflowView({
      schema: adminSchema,
      access: adminAccess,
      role: 'TENANT_ADMIN',
      record: visibilityRecord(),
    }).availableTransitions.map((item) => item.key);

    expect(keys).toContain('visible-transition');
    // `secret` is EDIT for the admin, so this Transition is simply normal.
    expect(keys).toContain('hidden-transition');

    expect(
      resolveExecutableTransition({
        schema: adminSchema,
        access: adminAccess,
        role: 'TENANT_ADMIN',
        record: visibilityRecord(),
        transitionKey: 'hidden-transition',
      }),
    ).toMatchObject({ key: 'hidden-transition', fromStateKey: 'new' });

    // The fail-closed rule is about membership in `access.fields`, not about
    // the role: `legacy-secret` is not a published field, so it is HIDDEN for
    // every Actor, admin included.
    expect(keys).not.toContain('legacy-transition');
    expect(
      executeVisibilityTransition({
        schema: adminSchema,
        access: adminAccess,
        role: 'TENANT_ADMIN',
        record: visibilityRecord(),
        transitionKey: 'legacy-transition',
      }).code,
    ).toBe('WORKFLOW_TRANSITION_FORBIDDEN');
  });
});
