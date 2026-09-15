import { ApiException } from '../../common/errors/api.exception';
import {
  findEmployeeAssignOwnerTransitions,
  validateTransitionActions,
} from './action-draft.policy';

const FIELD_PATH = 'transitions.0.actions';

type LooseAction = Record<string, unknown>;

function createRecordAction(overrides: LooseAction = {}): LooseAction {
  return {
    key: 'create-customer',
    type: 'CREATE_RECORD',
    targetObjectCode: 'customer',
    values: {
      name: { source: 'SOURCE_FIELD', fieldKey: 'companyName' },
    },
    ...overrides,
  };
}

function updateRecordAction(overrides: LooseAction = {}): LooseAction {
  return {
    key: 'update-source',
    type: 'UPDATE_RECORD',
    target: 'SOURCE_RECORD',
    values: {
      note: { source: 'LITERAL', value: '已转化' },
    },
    ...overrides,
  };
}

function createRelationAction(overrides: LooseAction = {}): LooseAction {
  return {
    key: 'link-customer',
    type: 'CREATE_RELATION',
    left: { source: 'SOURCE_RECORD' },
    right: {
      source: 'ACTION_OUTPUT',
      actionKey: 'create-customer',
      property: 'recordId',
    },
    ...overrides,
  };
}

function createFollowUpAction(overrides: LooseAction = {}): LooseAction {
  return {
    key: 'follow-up',
    type: 'CREATE_FOLLOW_UP',
    target: { source: 'SOURCE_RECORD' },
    title: { source: 'LITERAL', value: '首次回访' },
    dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
    assignee: { source: 'SOURCE_OWNER' },
    ...overrides,
  };
}

function assignOwnerAction(overrides: LooseAction = {}): LooseAction {
  return {
    key: 'assign-owner',
    type: 'ASSIGN_OWNER',
    target: 'SOURCE_RECORD',
    owner: { source: 'ACTOR' },
    ...overrides,
  };
}

/** Every V1 type in one ordered list: CREATE_RECORD first so refs point backwards. */
function allActionTypes(): LooseAction[] {
  return [
    createRecordAction(),
    createRelationAction(),
    createFollowUpAction({
      target: {
        source: 'ACTION_OUTPUT',
        actionKey: 'create-customer',
        property: 'recordId',
      },
    }),
    updateRecordAction({
      values: {
        note: {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'objectCode',
        },
      },
    }),
    assignOwnerAction(),
  ];
}

/** Independent actions for the count boundary: no cross references. */
function sourceOnlyRelations(count: number): LooseAction[] {
  return Array.from({ length: count }, (_, index) =>
    createRelationAction({
      key: `link-${index}`,
      right: { source: 'SOURCE_RECORD' },
    }),
  );
}

const typeFixtures: Array<{ type: string; build: () => LooseAction }> = [
  { type: 'CREATE_RECORD', build: createRecordAction },
  { type: 'UPDATE_RECORD', build: updateRecordAction },
  { type: 'CREATE_RELATION', build: createRelationAction },
  { type: 'CREATE_FOLLOW_UP', build: createFollowUpAction },
  { type: 'ASSIGN_OWNER', build: assignOwnerAction },
];

const requiredKeyFixtures: Array<{
  type: string;
  build: () => LooseAction;
  requiredKey: string;
}> = [
  { type: 'CREATE_RECORD', build: createRecordAction, requiredKey: 'values' },
  { type: 'UPDATE_RECORD', build: updateRecordAction, requiredKey: 'values' },
  {
    type: 'CREATE_RELATION',
    build: createRelationAction,
    requiredKey: 'right',
  },
  {
    type: 'CREATE_FOLLOW_UP',
    build: createFollowUpAction,
    requiredKey: 'dueAt',
  },
  { type: 'ASSIGN_OWNER', build: assignOwnerAction, requiredKey: 'owner' },
];

function run(
  actions: readonly unknown[] | null | undefined,
  fieldPath: string = FIELD_PATH,
): ReturnType<typeof validateTransitionActions> {
  return validateTransitionActions(actions, { fieldPath });
}

/** Asserts the validator rejects the input and returns the ApiException. */
function failure(
  actions: readonly unknown[] | null | undefined,
  fieldPath: string = FIELD_PATH,
): ApiException {
  try {
    run(actions, fieldPath);
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('expected validateTransitionActions to reject the actions');
}

function errorField(error: ApiException): string {
  return Object.keys(error.fieldErrors)[0] ?? '';
}

describe('validateTransitionActions', () => {
  it('accepts an empty action list', () => {
    expect(run([])).toEqual([]);
  });

  it('treats missing legacy action data as an empty list', () => {
    expect(run(undefined)).toEqual([]);
    expect(run(null)).toEqual([]);
  });

  it('rejects a legacy non-array action container', () => {
    const error = failure({
      create: 'create-customer',
    } as unknown as unknown[]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(FIELD_PATH);
  });

  it('accepts a valid action of every V1 type', () => {
    const actions = allActionTypes();
    expect(run(actions)).toEqual(actions);
  });

  it('normalizes action keys and resolves references against them', () => {
    const actions = [
      createRecordAction({ key: 'Create-Customer' }),
      createRelationAction({
        key: 'Link-Customer',
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'recordId',
        },
      }),
    ];
    expect(run(actions).map((action) => action.key)).toEqual([
      'create-customer',
      'link-customer',
    ]);
  });

  it('accepts exactly 20 actions', () => {
    expect(run(sourceOnlyRelations(20))).toHaveLength(20);
  });

  it('rejects more than 20 actions', () => {
    const error = failure(sourceOnlyRelations(21));
    expect(error.code).toBe('WORKFLOW_ACTION_LIMIT_EXCEEDED');
    expect(errorField(error)).toBe(FIELD_PATH);
  });

  it('rejects an invalid action key', () => {
    const error = failure([createRecordAction({ key: 'Create_Customer' })]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.key`);
  });

  it('rejects duplicate action keys after normalization', () => {
    const error = failure([
      createRecordAction({ key: 'create-customer' }),
      createRelationAction({ key: 'Create-Customer' }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_DUPLICATE_KEY');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.key`);
  });

  it('rejects an unsupported action type', () => {
    const error = failure([{ key: 'delete-record', type: 'DELETE_RECORD' }]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.type`);
  });

  it('rejects a non-object action', () => {
    const error = failure([createRecordAction(), 'create-customer']);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1`);
  });

  it.each(typeFixtures)(
    'rejects an undeclared property on $type',
    ({ build }) => {
      const error = failure([{ ...build(), searchFilter: 'x' }]);
      expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
      expect(errorField(error)).toBe(`${FIELD_PATH}.0.searchFilter`);
    },
  );

  it.each(requiredKeyFixtures)(
    'rejects a $type action missing $requiredKey',
    ({ build, requiredKey }) => {
      const action = build();
      delete action[requiredKey];
      const error = failure([action]);
      expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
      expect(errorField(error)).toBe(`${FIELD_PATH}.0.${requiredKey}`);
    },
  );

  it('rejects a blank target object code', () => {
    const error = failure([createRecordAction({ targetObjectCode: '   ' })]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.targetObjectCode`);
  });

  it('rejects UPDATE_RECORD targeting anything but the source record', () => {
    const error = failure([updateRecordAction({ target: 'ACTION_OUTPUT' })]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.target`);
  });

  it('rejects ASSIGN_OWNER owner other than the actor', () => {
    const error = failure([
      assignOwnerAction({ owner: { source: 'SOURCE_OWNER' } }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.owner`);
  });

  it('rejects a second ASSIGN_OWNER action', () => {
    const error = failure([
      assignOwnerAction(),
      assignOwnerAction({ key: 'assign-owner-again' }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.type`);
  });

  it('rejects a forward ACTION_OUTPUT reference', () => {
    const error = failure([
      createRelationAction({
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'recordId',
        },
      }),
      createRecordAction(),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_FORWARD_REFERENCE');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.right`);
  });

  it('rejects a self ACTION_OUTPUT reference', () => {
    const error = failure([
      createRelationAction({
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'link-customer',
          property: 'recordId',
        },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_FORWARD_REFERENCE');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.right`);
  });

  it('rejects an unknown output action', () => {
    const error = failure([
      createRelationAction({
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'missing-action',
          property: 'recordId',
        },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_OUTPUT_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.right`);
  });

  it('rejects an output property the referenced action does not produce', () => {
    const error = failure([
      createRecordAction(),
      updateRecordAction({
        values: {
          related: {
            source: 'ACTION_OUTPUT',
            actionKey: 'create-customer',
            property: 'relationId',
          },
        },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_OUTPUT_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.values.related.property`);
  });

  it('rejects a record reference output property other than recordId', () => {
    const error = failure([
      createRecordAction(),
      createRelationAction({
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-customer',
          property: 'objectCode',
        },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_OUTPUT_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.right.property`);
  });

  it('rejects an unsupported record reference source', () => {
    const error = failure([
      createRelationAction({ left: { source: 'SEARCH_RESULT' } }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.left.source`);
  });

  it('rejects duplicate source patch fields across UPDATE_RECORD actions', () => {
    const error = failure([
      updateRecordAction({
        key: 'update-stage',
        values: { stage: { source: 'LITERAL', value: 'won' } },
      }),
      updateRecordAction({
        key: 'update-stage-again',
        values: { stage: { source: 'SOURCE_FIELD', fieldKey: 'stage' } },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_SOURCE_PATCH_CONFLICT');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.values.stage`);
  });

  it('accepts UPDATE_RECORD actions writing different source fields', () => {
    const actions = [
      updateRecordAction({
        key: 'update-stage',
        values: { stage: { source: 'LITERAL', value: 'won' } },
      }),
      updateRecordAction({
        key: 'update-note',
        values: { note: { source: 'LITERAL', value: '已转化' } },
      }),
    ];
    expect(run(actions)).toEqual(actions);
  });

  it('accepts exactly 50 field mappings', () => {
    const values = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [
        `field${index}`,
        { source: 'LITERAL', value: index },
      ]),
    );
    const actions = [createRecordAction({ values })];
    expect(run(actions)).toEqual(actions);
  });

  it('rejects more than 50 field mappings', () => {
    const values = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [
        `field${index}`,
        { source: 'LITERAL', value: index },
      ]),
    );
    const error = failure([createRecordAction({ values })]);
    expect(error.code).toBe('WORKFLOW_ACTION_LIMIT_EXCEEDED');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.values`);
  });

  it('rejects a non-object field mapping map', () => {
    const error = failure([createRecordAction({ values: 'name' })]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.values`);
  });

  it('rejects an unsupported value source', () => {
    const error = failure([
      updateRecordAction({
        values: { note: { source: 'EXPRESSION', value: '1 + 1' } },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.values.note.source`);
  });

  it('rejects an undeclared property inside a value source', () => {
    const error = failure([
      updateRecordAction({
        values: {
          note: { source: 'LITERAL', value: '已转化', fieldKey: 'note' },
        },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.values.note.fieldKey`);
  });

  it('rejects a SOURCE_META property outside the allowlist', () => {
    const error = failure([
      updateRecordAction({
        values: { note: { source: 'SOURCE_META', property: 'createdAt' } },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.values.note.property`);
  });

  it('accepts SOURCE_META metadata, NOW dates and ACTOR members', () => {
    const actions = [
      updateRecordAction({
        values: {
          title: { source: 'SOURCE_META', property: 'title' },
          ownerMemberId: { source: 'SOURCE_META', property: 'ownerMemberId' },
          owner: { source: 'ACTOR' },
          reviewer: { source: 'ACTOR', memberId: 'member-1' },
          followedAt: { source: 'NOW' },
          promisedAt: { source: 'NOW_PLUS_DAYS', days: 0 },
          birthday: {
            source: 'LITERAL_DATETIME',
            value: '2026-09-16T10:00:00Z',
          },
        },
      }),
    ];
    expect(run(actions)).toEqual(actions);
  });

  it('rejects a NOW_PLUS_DAYS offset outside 0..3650', () => {
    const tooLate = failure([
      updateRecordAction({
        values: { followedAt: { source: 'NOW_PLUS_DAYS', days: 3651 } },
      }),
    ]);
    expect(tooLate.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(tooLate)).toBe(`${FIELD_PATH}.0.values.followedAt.days`);

    const fractional = failure([
      updateRecordAction({
        values: { followedAt: { source: 'NOW_PLUS_DAYS', days: 1.5 } },
      }),
    ]);
    expect(fractional.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(fractional)).toBe(
      `${FIELD_PATH}.0.values.followedAt.days`,
    );
  });

  it('rejects an unparsable LITERAL_DATETIME', () => {
    const error = failure([
      updateRecordAction({
        values: { followedAt: { source: 'LITERAL_DATETIME', value: '下周' } },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.values.followedAt.value`);
  });

  it('rejects a follow-up title source that is not a literal or source field', () => {
    const error = failure([
      createRecordAction(),
      createFollowUpAction({
        title: { source: 'SOURCE_META', property: 'title' },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.title.source`);
  });

  it('rejects a follow-up assignee outside ACTOR / SOURCE_OWNER', () => {
    const error = failure([
      createRecordAction(),
      createFollowUpAction({
        assignee: { source: 'ACTION_OUTPUT' },
      }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.1.assignee.source`);
  });

  it('rejects a created record owner outside ACTOR / SOURCE_OWNER', () => {
    const error = failure([
      createRecordAction({ owner: { source: 'ACTION_OUTPUT' } }),
    ]);
    expect(error.code).toBe('WORKFLOW_ACTION_INVALID');
    expect(errorField(error)).toBe(`${FIELD_PATH}.0.owner.source`);
  });

  it('reports action errors under the caller field path', () => {
    const error = failure(
      [createRecordAction(), createRecordAction({ key: 'create-customer' })],
      'transitions.3.actions',
    );
    expect(error.code).toBe('WORKFLOW_ACTION_DUPLICATE_KEY');
    expect(errorField(error)).toBe('transitions.3.actions.1.key');
  });
});

describe('findEmployeeAssignOwnerTransitions', () => {
  it('returns the indices of EMPLOYEE transitions that assign the owner', () => {
    expect(
      findEmployeeAssignOwnerTransitions([
        { allowedRoles: ['TENANT_ADMIN'], actions: [{ type: 'ASSIGN_OWNER' }] },
        { allowedRoles: ['EMPLOYEE'], actions: [{ type: 'CREATE_RECORD' }] },
        {
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          actions: [{ type: 'CREATE_RECORD' }, { type: 'ASSIGN_OWNER' }],
        },
        { allowedRoles: ['EMPLOYEE'], actions: [] },
      ]),
    ).toEqual([2]);
  });

  it('reports every offending index and nothing else', () => {
    expect(
      findEmployeeAssignOwnerTransitions([
        { allowedRoles: ['EMPLOYEE'], actions: [{ type: 'ASSIGN_OWNER' }] },
        { allowedRoles: ['EMPLOYEE'], actions: [] },
      ]),
    ).toEqual([0]);
    expect(findEmployeeAssignOwnerTransitions([])).toEqual([]);
  });
});
