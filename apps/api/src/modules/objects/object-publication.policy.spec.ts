import {
  analyzeActionPublication,
  collectActionTargetObjectCodes,
  type ActionPublicationTarget,
} from '../actions/action-publication.policy';
import type {
  ActionValueSource,
  WorkflowActionDraft,
} from '../actions/action.types';
import { validateWorkflowDraft } from '../workflows/workflow-draft.policy';
import type {
  JsonValue,
  PublishedFieldAccess,
  PublishedFieldType,
  PublishedObjectSchema,
} from './object-schema';
import {
  analyzePublication,
  compilePublication,
  type DraftFieldType,
  type PublicationDraft,
} from './object-publication.policy';

function validDraft(): PublicationDraft {
  return {
    object: {
      id: 'object-lead',
      code: 'leads',
      name: '销售线索',
      description: '首家公司使用的线索对象',
      titleFieldKey: 'name',
      icon: 'contacts',
      sortOrder: 20,
      version: 7,
      updatedAt: '2026-08-21T09:00:00.000Z',
    },
    fields: [
      {
        id: 'field-phone',
        fieldKey: 'phone',
        label: '手机号',
        type: 'PHONE',
        required: false,
        defaultValue: null,
        validation: { country: 'CN' },
        config: {},
        sortOrder: 20,
        isSystem: false,
        status: 'ACTIVE',
        updatedAt: '2026-08-21T09:00:00.000Z',
      },
      {
        id: 'field-name',
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: { maxLength: 100 },
        config: {},
        sortOrder: 10,
        isSystem: false,
        status: 'ACTIVE',
        updatedAt: '2026-08-21T09:00:00.000Z',
      },
    ],
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name', 'phone'],
      sort: { field: 'updatedAt', direction: 'desc' },
      updatedAt: '2026-08-21T09:00:00.000Z',
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'OWN',
      fields: { name: 'EDIT', phone: 'READ_ONLY' },
      memberOverrides: { 'member-1': { canRead: false } },
    },
    activeSchema: null,
    activeRecordCount: 0,
  };
}

function blockingCodes(draft: PublicationDraft): string[] {
  return analyzePublication(draft).blocking.map((issue) => issue.code);
}

describe('object publication policy', () => {
  it('blocks a title field that is not required', () => {
    const draft = validDraft();
    draft.fields[1].required = false;

    expect(blockingCodes(draft)).toContain('TITLE_FIELD_REQUIRED');
  });

  it('blocks an unsupported title field type', () => {
    const draft = validDraft();
    draft.fields[1].type = 'ATTACHMENT';

    expect(blockingCodes(draft)).toContain('TITLE_FIELD_TYPE_UNSUPPORTED');
  });

  it('blocks a missing default view', () => {
    const draft = validDraft();
    draft.defaultView = null;

    expect(blockingCodes(draft)).toContain('DEFAULT_VIEW_REQUIRED');
  });

  it('blocks a default-view column that references an inactive field', () => {
    const draft = validDraft();
    draft.fields[0].status = 'INACTIVE';

    expect(blockingCodes(draft)).toContain('DEFAULT_VIEW_FIELD_INACTIVE');
  });

  it('blocks a search field that is not a searchable type', () => {
    const draft = validDraft();
    draft.fields.push({
      id: 'field-amount',
      fieldKey: 'amount',
      label: '金额',
      type: 'MONEY',
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 30,
      isSystem: false,
      status: 'ACTIVE',
    });
    draft.defaultView = {
      ...draft.defaultView!,
      searchFieldKeys: ['amount'],
    };

    expect(blockingCodes(draft)).toContain('SEARCH_FIELD_TYPE_UNSUPPORTED');
  });

  it('blocks a missing explicit employee role policy', () => {
    const draft = validDraft();
    draft.employeeAccess = null;

    expect(blockingCodes(draft)).toContain('EMPLOYEE_ACCESS_REQUIRED');
  });

  it('blocks duplicate select option keys', () => {
    const draft = validDraft();
    draft.fields.push({
      id: 'field-source',
      fieldKey: 'source',
      label: '来源',
      type: 'SINGLE_SELECT',
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [
          { key: 'referral', label: '转介绍' },
          { key: 'referral', label: '客户转介绍' },
        ],
      },
      sortOrder: 30,
      isSystem: false,
      status: 'ACTIVE',
    });

    expect(blockingCodes(draft)).toContain('FIELD_OPTION_KEY_DUPLICATE');
  });

  it('blocks a newly published required field while active records exist', () => {
    const draft = validDraft();
    draft.activeRecordCount = 3;
    draft.fields.push({
      id: 'field-company',
      fieldKey: 'company',
      label: '公司',
      type: 'TEXT',
      required: true,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 30,
      isSystem: false,
      status: 'ACTIVE',
    });

    expect(analyzePublication(draft).blocking).toContainEqual({
      code: 'REQUIRED_FIELD_HAS_MISSING_VALUES',
      message: '现有记录缺少该字段值，暂时不能发布为必填字段。',
      fieldKey: 'company',
    });
  });

  it('reports an added optional field as a non-blocking change', () => {
    const draft = validDraft();
    draft.activeSchema = compilePublication({
      ...validDraft(),
      fields: validDraft().fields.filter((field) => field.fieldKey === 'name'),
      defaultView: {
        ...validDraft().defaultView!,
        columnFieldKeys: ['name'],
      },
      publication: {
        id: 'publication-1',
        number: 1,
        sourceDraftVersion: 6,
        publishedAt: '2026-08-20T09:00:00.000Z',
      },
    });

    const analysis = analyzePublication(draft);

    expect(analysis.blocking).toEqual([]);
    expect(analysis.changes).toContainEqual({
      kind: 'ADDED',
      fieldKey: 'phone',
    });
  });

  it('compiles the exact stable schema without draft timestamps or member overrides', () => {
    const schema = compilePublication({
      ...validDraft(),
      publication: {
        id: 'publication-2',
        number: 2,
        sourceDraftVersion: 7,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
    });

    expect(schema.defaultView.searchFieldKeys).toBeUndefined();
    expect(schema).toEqual({
      publication: {
        id: 'publication-2',
        number: 2,
        sourceDraftVersion: 7,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
      object: {
        id: 'object-lead',
        code: 'leads',
        name: '销售线索',
        description: '首家公司使用的线索对象',
        titleFieldKey: 'name',
        icon: 'contacts',
        sortOrder: 20,
      },
      fields: [
        {
          id: 'field-name',
          fieldKey: 'name',
          label: '姓名',
          type: 'TEXT',
          required: true,
          defaultValue: null,
          validation: { maxLength: 100 },
          config: {},
          sortOrder: 10,
          isSystem: false,
        },
        {
          id: 'field-phone',
          fieldKey: 'phone',
          label: '手机号',
          type: 'PHONE',
          required: false,
          defaultValue: null,
          validation: { country: 'CN' },
          config: {},
          sortOrder: 20,
          isSystem: false,
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
    });
  });

  it('compiles an enabled workflow into the published snapshot', () => {
    const schema = compilePublication({
      ...validDraft(),
      workflow: {
        isEnabled: true,
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
            requiredFieldKeys: ['phone'],
            sortOrder: 10,
          },
        ],
      },
      publication: {
        id: 'publication-2',
        number: 2,
        sourceDraftVersion: 7,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
    });

    expect(schema.workflow).toEqual({
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
          requiredFieldKeys: ['phone'],
          actions: [],
        },
      ],
    });
  });

  it('omits workflow from snapshots when the draft is disabled', () => {
    const schema = compilePublication({
      ...validDraft(),
      workflow: {
        isEnabled: false,
        initialStateKey: 'new',
        states: [
          { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
        ],
        transitions: [],
      },
      publication: {
        id: 'publication-2',
        number: 2,
        sourceDraftVersion: 7,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
    });

    expect(schema.workflow).toBeUndefined();
  });

  it('blocks a required field that does not exist on the object', () => {
    const draft = validDraft();
    draft.workflow = {
      isEnabled: true,
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
          allowedRoles: ['TENANT_ADMIN'],
          requiredFieldKeys: ['amount'],
          sortOrder: 10,
        },
      ],
    };

    expect(blockingCodes(draft)).toContain('WORKFLOW_REQUIRED_FIELD_UNKNOWN');
  });

  it('blocks removing a published state that records still use', () => {
    const draft = validDraft();
    draft.activeSchema = {
      ...compilePublication({
        ...validDraft(),
        workflow: {
          isEnabled: true,
          initialStateKey: 'new',
          states: [
            { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
            { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
          ],
          transitions: [],
        },
        publication: {
          id: 'publication-1',
          number: 1,
          sourceDraftVersion: 6,
          publishedAt: '2026-08-21T09:00:00.000Z',
        },
      }),
    };
    draft.workflow = {
      isEnabled: true,
      initialStateKey: 'new',
      states: [{ key: 'new', label: '新建', sortOrder: 10, isTerminal: false }],
      transitions: [],
    };
    draft.workflowStateRecordCounts = { won: 3 };

    expect(analyzePublication(draft).blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'WORKFLOW_STATE_IN_USE',
          fieldKey: 'won',
        }),
      ]),
    );
  });

  it('compiles explicit searchFieldKeys into the published default view', () => {
    const schema = compilePublication({
      ...validDraft(),
      defaultView: {
        ...validDraft().defaultView!,
        searchFieldKeys: ['phone'],
      },
      publication: {
        id: 'publication-2',
        number: 2,
        sourceDraftVersion: 7,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
    });

    expect(schema.defaultView.searchFieldKeys).toEqual(['phone']);
  });

  it('freezes transition actions into the published snapshot in order', () => {
    const actions: WorkflowActionDraft[] = [
      {
        key: 'create-contact',
        type: 'CREATE_RECORD',
        targetObjectCode: 'contacts',
        values: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
        owner: { source: 'ACTOR' },
      },
      {
        key: 'link-contact',
        type: 'CREATE_RELATION',
        left: { source: 'SOURCE_RECORD' },
        right: {
          source: 'ACTION_OUTPUT',
          actionKey: 'create-contact',
          property: 'recordId',
        },
      },
      {
        key: 'assign-actor',
        type: 'ASSIGN_OWNER',
        target: 'SOURCE_RECORD',
        owner: { source: 'ACTOR' },
      },
    ];
    const draft = validDraft();
    draft.workflow = {
      isEnabled: true,
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
          allowedRoles: ['TENANT_ADMIN'],
          requiredFieldKeys: ['phone'],
          sortOrder: 10,
          actions,
        },
      ],
    };

    const schema = compilePublication({
      ...draft,
      publication: {
        id: 'publication-2',
        number: 2,
        sourceDraftVersion: 7,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
    });

    // Array order is execution order (§28), so the frozen copy keeps it.
    expect(schema.workflow?.transitions[0]?.actions).toEqual(actions);
    expect(
      schema.workflow?.transitions[0]?.actions.map((action) => action.key),
    ).toEqual(['create-contact', 'link-contact', 'assign-actor']);
    // Frozen by copy: later draft edits must not reach the snapshot.
    actions[0].key = 'renamed';
    expect(schema.workflow?.transitions[0]?.actions[0]?.key).toBe(
      'create-contact',
    );
  });
});

it('blocks publication with a hidden employee title', () => {
  const draft = validDraft();
  draft.employeeAccess!.fields.name = 'HIDDEN';
  expect(analyzePublication(draft).blocking).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'TITLE_FIELD_HIDDEN', fieldKey: 'name' }),
    ]),
  );
});

/**
 * Task 8 — cross-object Action analysis at publication time (§15, §20, §25,
 * §26, §27, §34).
 *
 * Everything here asserts the ANALYSIS: the draft validator owns structure
 * (shape, limit, key syntax/uniqueness, supported type, payload, source-patch
 * ordering) and these tests never claim otherwise — they only require that a
 * structurally valid draft still cannot publish a configuration that could never
 * execute.
 */

interface SpecField {
  fieldKey: string;
  type: DraftFieldType;
  required?: boolean;
  defaultValue?: JsonValue;
  config?: Record<string, JsonValue>;
  isSystem?: boolean;
}

const SELECT_OPTIONS = {
  options: [{ key: 'a', label: 'A' }],
};

function draftFields(fields: SpecField[]) {
  return fields.map((spec, index) => ({
    id: `field-${spec.fieldKey}`,
    fieldKey: spec.fieldKey,
    label: spec.fieldKey,
    type: spec.type,
    required: spec.required ?? false,
    defaultValue: spec.defaultValue ?? null,
    validation: {},
    config: spec.config ?? {},
    sortOrder: (index + 1) * 10,
    isSystem: spec.isSystem ?? false,
    status: 'ACTIVE' as const,
  }));
}

/** A source draft that is publishable on its own (`name` is the title field). */
function publishableDraft(fields: SpecField[]): PublicationDraft {
  const all: SpecField[] = [
    { fieldKey: 'name', type: 'TEXT', required: true },
    ...fields,
  ];
  return {
    object: {
      id: 'object-lead',
      code: 'leads',
      name: '销售线索',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 10,
      version: 5,
    },
    fields: draftFields(all),
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'OWN',
      fields: Object.fromEntries(all.map((field) => [field.fieldKey, 'EDIT'])),
    },
    activeSchema: null,
    activeRecordCount: 0,
  };
}

function targetSchema(
  code: string,
  fields: SpecField[],
  options: {
    canCreate?: boolean;
    fieldAccess?: Record<string, PublishedFieldAccess>;
    withEmployeeAccess?: boolean;
  } = {},
): PublishedObjectSchema {
  const schema: PublishedObjectSchema = {
    publication: {
      id: `publication-${code}-1`,
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-08-20T09:00:00.000Z',
    },
    object: {
      id: `object-${code}`,
      code,
      name: code,
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 10,
    },
    fields: fields.map((spec, index) => ({
      id: `target-field-${spec.fieldKey}`,
      fieldKey: spec.fieldKey,
      label: spec.fieldKey,
      type: spec.type as PublishedFieldType,
      required: spec.required ?? false,
      defaultValue: spec.defaultValue ?? null,
      validation: {},
      config: spec.config ?? {},
      sortOrder: (index + 1) * 10,
      isSystem: spec.isSystem ?? false,
    })),
    defaultView: {
      code: 'default',
      name: '全部',
      columnFieldKeys: [],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: options.canCreate ?? true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'ALL',
      updateScope: 'ALL',
      fields:
        options.fieldAccess ??
        Object.fromEntries(fields.map((field) => [field.fieldKey, 'EDIT'])),
    },
  };
  if (options.withEmployeeAccess === false) {
    return withoutEmployeeAccess(schema);
  }
  return schema;
}

/**
 * A legacy or hand-made snapshot may carry no employee policy at all; the
 * runtime (`effective-access.ts`) then grants employees nothing.
 */
function withoutEmployeeAccess(
  schema: PublishedObjectSchema,
): PublishedObjectSchema {
  const copy = { ...schema } as Record<string, unknown>;
  delete copy.employeeAccess;
  return copy as unknown as PublishedObjectSchema;
}

function target(
  code: string,
  schema: PublishedObjectSchema | null,
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
): ActionPublicationTarget {
  return { code, status, schema };
}

interface SpecTransition {
  key?: string;
  fromStateKey?: string;
  toStateKey?: string;
  allowedRoles: Array<'TENANT_ADMIN' | 'EMPLOYEE'>;
  actions: WorkflowActionDraft[];
}

function withWorkflow(
  draft: PublicationDraft,
  ...transitions: SpecTransition[]
): PublicationDraft {
  draft.workflow = {
    isEnabled: true,
    initialStateKey: 'new',
    states: [
      { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      { key: 'won', label: '赢单', sortOrder: 20, isTerminal: false },
      { key: 'lost', label: '输单', sortOrder: 30, isTerminal: true },
    ],
    transitions: transitions.map((transition, index) => ({
      key: transition.key ?? 'mark-won',
      label: transition.key ?? '标记赢单',
      fromStateKey: transition.fromStateKey ?? 'new',
      toStateKey: transition.toStateKey ?? 'won',
      allowedRoles: transition.allowedRoles,
      requiredFieldKeys: [],
      sortOrder: (index + 1) * 10,
      actions: transition.actions,
    })),
  };
  return draft;
}

function blockingIssues(
  draft: PublicationDraft,
  targets: Record<string, ActionPublicationTarget> = {},
) {
  draft.actionTargets = new Map(Object.entries(targets));
  return analyzePublication(draft).blocking;
}

/** Only the Action-analysis issues, so unrelated blockers cannot mask them. */
function actionIssues(
  draft: PublicationDraft,
  targets: Record<string, ActionPublicationTarget> = {},
) {
  return blockingIssues(draft, targets).filter((issue) =>
    issue.code.startsWith('WORKFLOW_ACTION_'),
  );
}

function createRecord(
  targetObjectCode: string,
  values: Record<string, ActionValueSource> = {},
): WorkflowActionDraft {
  return {
    key: 'create-contact',
    type: 'CREATE_RECORD',
    targetObjectCode,
    values,
  };
}

function sourceField(fieldKey: string) {
  return { source: 'SOURCE_FIELD' as const, fieldKey };
}

function defaultContactsTarget(
  options: {
    canCreate?: boolean;
    fieldAccess?: Record<string, PublishedFieldAccess>;
  } = {},
): ActionPublicationTarget {
  return target(
    'contacts',
    targetSchema(
      'contacts',
      [
        {
          fieldKey: 'name',
          type: 'TEXT',
          required: true,
          defaultValue: '未命名',
        },
        { fieldKey: 'phone', type: 'PHONE' },
      ],
      options,
    ),
  );
}

const COMPARABLE_TYPES: PublishedFieldType[] = [
  'TEXT',
  'TEXTAREA',
  'PHONE',
  'EMAIL',
  'NUMBER',
  'MONEY',
  'DATE',
  'DATETIME',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'MEMBER',
  'BOOLEAN',
];

function typeConfig(type: string): Record<string, JsonValue> {
  return type === 'SINGLE_SELECT' || type === 'MULTI_SELECT'
    ? { ...SELECT_OPTIONS }
    : {};
}

describe('object publication policy: workflow actions', () => {
  it('adds no action issues when a transition has no actions', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [],
      },
    );

    expect(blockingIssues(draft)).toEqual([]);
  });

  it('adds no action issues for a legacy transition without an actions key', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
        actions: [],
      },
    );
    draft.workflow!.transitions[0].actions = undefined;

    expect(blockingIssues(draft)).toEqual([]);
  });

  it('blocks an Action whose Target Object does not exist in the tenant', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(actionIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
      }),
    ]);
  });

  it('locates the offending Transition and Action of a cross-object issue', () => {
    // §34: the UI must be able to locate the offending Transition / Action.
    // Two DIFFERENT Transitions each create a record into the SAME missing
    // Target Object, so the messages are byte-identical: without
    // `transitionKey`/`actionKey` neither a human nor the UI could tell the two
    // broken steps apart or know where to send the admin.
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        key: 'mark-won',
        allowedRoles: ['TENANT_ADMIN'],
        actions: [{ ...createRecord('ghost'), key: 'create-ghost-on-won' }],
      },
      {
        key: 'mark-lost',
        fromStateKey: 'new',
        toStateKey: 'lost',
        allowedRoles: ['TENANT_ADMIN'],
        actions: [{ ...createRecord('ghost'), key: 'create-ghost-on-lost' }],
      },
    );

    const issues = actionIssues(draft);

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
        transitionKey: 'mark-won',
        actionKey: 'create-ghost-on-won',
      }),
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
        transitionKey: 'mark-lost',
        actionKey: 'create-ghost-on-lost',
      }),
    ]);
    // Distinguishable: one locator pair per broken Transition/Action.
    expect(issues.map((issue) => issue.transitionKey)).toEqual([
      'mark-won',
      'mark-lost',
    ]);
    expect(issues.map((issue) => issue.actionKey)).toEqual([
      'create-ghost-on-won',
      'create-ghost-on-lost',
    ]);
  });

  it('blocks an Action whose Target Object has no Active Publication', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(actionIssues(draft, { contacts: target('contacts', null) })).toEqual(
      [
        expect.objectContaining({
          code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
        }),
      ],
    );
  });

  it('blocks an Action whose Target Object is not ACTIVE', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [{ fieldKey: 'phone', type: 'PHONE' }]),
          'ARCHIVED',
        ),
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_OBJECT_INVALID',
      }),
    ]);
  });

  it('blocks a mapping onto a field the Target Object does not publish', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          createRecord('contacts', {
            nickname: { source: 'LITERAL', value: 'x' },
          }),
        ],
      },
    );

    expect(actionIssues(draft, { contacts: defaultContactsTarget() })).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
        fieldKey: 'nickname',
        transitionKey: 'mark-won',
        actionKey: 'create-contact',
      }),
    ]);
  });

  it('blocks a SOURCE_FIELD that the Source Object does not have', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('mobile') })],
      },
    );

    const issues = actionIssues(draft, { contacts: defaultContactsTarget() });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_INVALID',
        fieldKey: 'mobile',
      }),
    ]);
    expect(issues[0].message).toContain('mobile');
  });

  describe('field-type compatibility', () => {
    describe.each(COMPARABLE_TYPES)('copying %s', (sourceType) => {
      it.each(COMPARABLE_TYPES)(
        'onto %s requires an exact type match',
        (targetType) => {
          const draft = withWorkflow(
            publishableDraft([
              {
                fieldKey: 'src',
                type: sourceType,
                config: typeConfig(sourceType),
              },
            ]),
            {
              allowedRoles: ['TENANT_ADMIN'],
              actions: [createRecord('contacts', { dst: sourceField('src') })],
            },
          );
          const issues = actionIssues(draft, {
            contacts: target(
              'contacts',
              targetSchema('contacts', [
                {
                  fieldKey: 'dst',
                  type: targetType,
                  config: typeConfig(targetType),
                },
              ]),
            ),
          });

          // §15: SOURCE_FIELD copies require the Source / Target field type to be
          // identical — TEXT→MONEY, DATE→DATETIME and NUMBER→TEXT are rejected,
          // and nothing wider is accepted either.
          expect(
            issues.filter(
              (issue) => issue.code === 'WORKFLOW_ACTION_FIELD_TYPE_MISMATCH',
            ),
          ).toHaveLength(sourceType === targetType ? 0 : 1);
        },
      );
    });
  });

  it('blocks copying a select field whose option keys the target does not accept', () => {
    const draft = withWorkflow(
      publishableDraft([
        {
          fieldKey: 'grade',
          type: 'SINGLE_SELECT',
          config: {
            options: [
              { key: 'hot', label: '热' },
              { key: 'cold', label: '冷' },
            ],
          },
        },
      ]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { grade: sourceField('grade') })],
      },
    );

    const issues = actionIssues(draft, {
      contacts: target(
        'contacts',
        targetSchema('contacts', [
          {
            fieldKey: 'grade',
            type: 'SINGLE_SELECT',
            config: { options: [{ key: 'hot', label: '热' }] },
          },
        ]),
      ),
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
        fieldKey: 'grade',
      }),
    ]);
    expect(issues[0].message).toContain('cold');
  });

  it('accepts a select copy whose option keys the target accepts', () => {
    const draft = withWorkflow(
      publishableDraft([
        {
          fieldKey: 'grade',
          type: 'SINGLE_SELECT',
          config: { options: [{ key: 'hot', label: '热' }] },
        },
      ]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { grade: sourceField('grade') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [
            {
              fieldKey: 'grade',
              type: 'SINGLE_SELECT',
              config: {
                options: [
                  { key: 'hot', label: '热' },
                  { key: 'cold', label: '冷' },
                ],
              },
            },
          ]),
        ),
      }),
    ).toEqual([]);
  });

  it('blocks a required target field with neither a default nor a mapping', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [
            {
              fieldKey: 'name',
              type: 'TEXT',
              required: true,
              defaultValue: '未命名',
            },
            { fieldKey: 'amount', type: 'MONEY', required: true },
            { fieldKey: 'phone', type: 'PHONE' },
          ]),
        ),
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_REQUIRED_MAPPING_MISSING',
        fieldKey: 'amount',
        transitionKey: 'mark-won',
        actionKey: 'create-contact',
      }),
    ]);
  });

  it('accepts a required target field that is mapped', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'amount', type: 'MONEY' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { amount: sourceField('amount') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [
            {
              fieldKey: 'name',
              type: 'TEXT',
              required: true,
              defaultValue: '未命名',
            },
            { fieldKey: 'amount', type: 'MONEY', required: true },
          ]),
        ),
      }),
    ).toEqual([]);
  });

  it('accepts a required target field that has a valid default', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [
            {
              fieldKey: 'name',
              type: 'TEXT',
              required: true,
              defaultValue: '未命名',
            },
            {
              fieldKey: 'amount',
              type: 'MONEY',
              required: true,
              defaultValue: '0.00',
            },
            { fieldKey: 'phone', type: 'PHONE' },
          ]),
        ),
      }),
    ).toEqual([]);
  });

  it('blocks an Employee create when the target Employee default denies create', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['EMPLOYEE'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: defaultContactsTarget({ canCreate: false }),
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
      }),
    ]);
  });

  it('leaves a create to an object whose Employee default denies create to admins only', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: defaultContactsTarget({ canCreate: false }),
      }),
    ).toEqual([]);
  });

  it('blocks an Employee create into a snapshot with no employee policy', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['EMPLOYEE'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [{ fieldKey: 'phone', type: 'PHONE' }], {
            withEmployeeAccess: false,
          }),
        ),
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
      }),
    ]);
  });

  it('blocks a mapped target field that employees cannot edit', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['EMPLOYEE'],
        actions: [createRecord('contacts', { phone: sourceField('phone') })],
      },
    );

    expect(
      actionIssues(draft, {
        contacts: defaultContactsTarget({
          fieldAccess: { name: 'EDIT', phone: 'HIDDEN' },
        }),
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
        fieldKey: 'phone',
      }),
    ]);
  });

  it('blocks an Employee mapping onto a system field, which is read-only for employees', () => {
    const draft = withWorkflow(publishableDraft([]), {
      allowedRoles: ['EMPLOYEE'],
      actions: [createRecord('contacts', { code: sourceField('name') })],
    });

    expect(
      actionIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [
            {
              fieldKey: 'name',
              type: 'TEXT',
              required: true,
              defaultValue: '未命名',
            },
            { fieldKey: 'code', type: 'TEXT', isSystem: true },
          ]),
        ),
      }),
    ).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
        fieldKey: 'code',
      }),
    ]);
  });

  it('blocks an Employee-mapped source field that employees cannot edit', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['EMPLOYEE'],
        actions: [
          {
            key: 'update-source',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { phone: sourceField('phone') },
          },
        ],
      },
    );
    draft.employeeAccess!.fields.phone = 'READ_ONLY';

    expect(blockingIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
        fieldKey: 'phone',
      }),
    ]);
  });

  it('blocks an update of a field the Source Object does not have', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'update-source',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { nickname: { source: 'LITERAL', value: 'x' } },
          },
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_TARGET_FIELD_INVALID',
        fieldKey: 'nickname',
        transitionKey: 'mark-won',
        actionKey: 'update-source',
      }),
    ]);
  });

  it('blocks Employee transitions that assign the owner', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['EMPLOYEE'],
        actions: [
          {
            key: 'assign-actor',
            type: 'ASSIGN_OWNER',
            target: 'SOURCE_RECORD',
            owner: { source: 'ACTOR' },
          },
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_PERMISSION_INCOMPATIBLE',
      }),
    ]);
  });

  it('accepts an admin transition that assigns the owner', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'assign-actor',
            type: 'ASSIGN_OWNER',
            target: 'SOURCE_RECORD',
            owner: { source: 'ACTOR' },
          },
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([]);
  });

  it('blocks a follow-up whose title reads a field the Source Object does not have', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'follow-up',
            type: 'CREATE_FOLLOW_UP',
            target: { source: 'SOURCE_RECORD' },
            title: { source: 'SOURCE_FIELD', fieldKey: 'nickname' },
            dueAt: { source: 'NOW' },
            assignee: { source: 'ACTOR' },
          },
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_INVALID',
        fieldKey: 'nickname',
      }),
    ]);
  });

  it('blocks a follow-up whose due date reads a field the Source Object does not have', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'follow-up',
            type: 'CREATE_FOLLOW_UP',
            target: { source: 'SOURCE_RECORD' },
            title: { source: 'LITERAL', value: '回访' },
            dueAt: { source: 'SOURCE_FIELD', fieldKey: 'nickname' },
            assignee: { source: 'ACTOR' },
          },
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_INVALID',
        fieldKey: 'nickname',
      }),
    ]);
  });

  it('accepts a follow-up that reads a field the Source Object has', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'follow-up',
            type: 'CREATE_FOLLOW_UP',
            target: { source: 'SOURCE_RECORD' },
            title: { source: 'SOURCE_FIELD', fieldKey: 'name' },
            dueAt: { source: 'NOW' },
            assignee: { source: 'ACTOR' },
          },
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([]);
  });

  it('surfaces a forward action reference', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'link-contact',
            type: 'CREATE_RELATION',
            left: { source: 'SOURCE_RECORD' },
            right: {
              source: 'ACTION_OUTPUT',
              actionKey: 'create-contact',
              property: 'recordId',
            },
          },
          {
            key: 'create-contact',
            type: 'CREATE_RECORD',
            targetObjectCode: 'contacts',
            values: {},
          },
        ],
      },
    );

    expect(
      blockingIssues(draft, { contacts: defaultContactsTarget() }),
    ).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_ACTION_FORWARD_REFERENCE' }),
    ]);
  });

  it('surfaces an output property the referenced action does not produce', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'create-contact',
            type: 'CREATE_RECORD',
            targetObjectCode: 'contacts',
            values: {},
          },
          {
            key: 'link-contact',
            type: 'CREATE_RELATION',
            left: { source: 'SOURCE_RECORD' },
            right: {
              source: 'ACTION_OUTPUT',
              actionKey: 'create-contact',
              // Legacy/persisted drafts are untrusted JSON, so an output property
              // the referenced Action never produces can reach the publication
              // flow even though the typed shape forbids it.
              property: 'relationId' as never,
            },
          },
        ],
      },
    );

    expect(
      blockingIssues(draft, { contacts: defaultContactsTarget() }),
    ).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_ACTION_OUTPUT_INVALID' }),
    ]);
  });

  it('surfaces a duplicate source patch field', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'first-update',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { phone: { source: 'LITERAL', value: '1' } },
          },
          {
            key: 'second-update',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { phone: { source: 'LITERAL', value: '2' } },
          },
        ],
      },
    );

    expect(blockingIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_SOURCE_PATCH_CONFLICT',
      }),
    ]);
  });

  it('surfaces a second owner mutation', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'first-owner',
            type: 'ASSIGN_OWNER',
            target: 'SOURCE_RECORD',
            owner: { source: 'ACTOR' },
          },
          {
            key: 'second-owner',
            type: 'ASSIGN_OWNER',
            target: 'SOURCE_RECORD',
            owner: { source: 'ACTOR' },
          },
        ],
      },
    );

    expect(blockingIssues(draft)).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_ACTION_INVALID' }),
    ]);
  });

  it('surfaces a duplicate action key', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'create-contact',
            type: 'CREATE_RECORD',
            targetObjectCode: 'contacts',
            values: {},
          },
          {
            key: 'create-contact',
            type: 'CREATE_RECORD',
            targetObjectCode: 'contacts',
            values: {},
          },
        ],
      },
    );

    expect(
      blockingIssues(draft, { contacts: defaultContactsTarget() }),
    ).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_ACTION_DUPLICATE_KEY' }),
    ]);
  });

  it('surfaces the action limit', () => {
    const draft = withWorkflow(
      publishableDraft([{ fieldKey: 'phone', type: 'PHONE' }]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: Array.from({ length: 21 }, (_unused, index) => ({
          key: `create-${index}`,
          type: 'CREATE_RECORD' as const,
          targetObjectCode: 'contacts',
          values: {},
        })),
      },
    );

    expect(
      blockingIssues(draft, { contacts: defaultContactsTarget() }),
    ).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_ACTION_LIMIT_EXCEEDED' }),
    ]);
  });

  it('analyzes a self-targeted create against the pending source schema', () => {
    const draft = withWorkflow(
      publishableDraft([
        { fieldKey: 'phone', type: 'PHONE' },
        { fieldKey: 'note', type: 'TEXT', required: true },
      ]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          createRecord('leads', {
            name: sourceField('name'),
            phone: sourceField('phone'),
          }),
        ],
      },
    );

    // No publication exists yet, and the runtime resolves a self-target through
    // the source object's own schema (`action-engine.ts:resolveObjectFor`), so
    // the pending publication is the schema that decides this — including the
    // required field the old publication would not have had.
    expect(actionIssues(draft)).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_ACTION_REQUIRED_MAPPING_MISSING',
        fieldKey: 'note',
      }),
    ]);
  });

  it('accepts a self-targeted create that covers the pending required fields', () => {
    const draft = withWorkflow(
      publishableDraft([
        { fieldKey: 'phone', type: 'PHONE' },
        { fieldKey: 'note', type: 'TEXT', required: true },
      ]),
      {
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          createRecord('leads', {
            name: sourceField('name'),
            phone: sourceField('phone'),
            note: sourceField('note'),
          }),
        ],
      },
    );

    expect(actionIssues(draft)).toEqual([]);
  });

  it('accepts a fully compatible workflow', () => {
    const draft = withWorkflow(
      publishableDraft([
        { fieldKey: 'phone', type: 'PHONE' },
        { fieldKey: 'grade', type: 'SINGLE_SELECT', config: SELECT_OPTIONS },
      ]),
      {
        // §20: an owner change may never be reachable by employees, so the
        // admin-only transition carries it and the employee transition does not.
        allowedRoles: ['TENANT_ADMIN'],
        actions: [
          {
            key: 'create-contact',
            type: 'CREATE_RECORD',
            targetObjectCode: 'contacts',
            values: {
              phone: sourceField('phone'),
              grade: sourceField('grade'),
            },
            owner: { source: 'ACTOR' },
          },
          {
            key: 'link-contact',
            type: 'CREATE_RELATION',
            left: { source: 'SOURCE_RECORD' },
            right: {
              source: 'ACTION_OUTPUT',
              actionKey: 'create-contact',
              property: 'recordId',
            },
          },
          {
            key: 'assign-actor',
            type: 'ASSIGN_OWNER',
            target: 'SOURCE_RECORD',
            owner: { source: 'ACTOR' },
          },
        ],
      },
      {
        key: 'advance',
        fromStateKey: 'won',
        toStateKey: 'lost',
        allowedRoles: ['EMPLOYEE'],
        actions: [
          {
            key: 'follow-up',
            type: 'CREATE_FOLLOW_UP',
            target: { source: 'SOURCE_RECORD' },
            title: { source: 'LITERAL', value: '回访' },
            dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
            assignee: { source: 'ACTOR' },
          },
          {
            key: 'update-source',
            type: 'UPDATE_RECORD',
            target: 'SOURCE_RECORD',
            values: { phone: sourceField('phone') },
          },
        ],
      },
    );

    expect(
      blockingIssues(draft, {
        contacts: target(
          'contacts',
          targetSchema('contacts', [
            {
              fieldKey: 'name',
              type: 'TEXT',
              required: true,
              defaultValue: '未命名',
            },
            {
              fieldKey: 'phone',
              type: 'PHONE',
              required: true,
            },
            {
              fieldKey: 'grade',
              type: 'SINGLE_SELECT',
              config: SELECT_OPTIONS,
            },
          ]),
        ),
      }),
    ).toEqual([]);
  });
});

describe('action publication policy', () => {
  it('is a pure function over the supplied target context', () => {
    const issues = analyzeActionPublication({
      source: {
        code: 'leads',
        schema: {
          fields: [
            {
              fieldKey: 'name',
              type: 'TEXT',
              required: true,
              defaultValue: null,
              config: {},
              isSystem: false,
            },
          ],
          employeeAccess: null,
        },
      },
      transitions: [
        {
          key: 'mark-won',
          allowedRoles: ['TENANT_ADMIN'],
          actions: [
            {
              key: 'create-contact',
              type: 'CREATE_RECORD',
              targetObjectCode: 'contacts',
              values: { phone: sourceField('name') },
            },
          ],
        },
      ],
      targets: new Map([
        [
          'contacts',
          target(
            'contacts',
            targetSchema('contacts', [{ fieldKey: 'phone', type: 'PHONE' }]),
          ),
        ],
      ]),
    });

    expect(issues).toEqual([
      expect.objectContaining({ code: 'WORKFLOW_ACTION_FIELD_TYPE_MISMATCH' }),
    ]);
  });

  it('collects the unique Target Object codes of a create-record draft', () => {
    expect(
      collectActionTargetObjectCodes([
        {
          actions: [
            { type: 'CREATE_RECORD', targetObjectCode: 'contacts' },
            { type: 'CREATE_RECORD', targetObjectCode: 'contacts' },
            { type: 'CREATE_RELATION' },
          ],
        },
        { actions: [{ type: 'CREATE_RECORD', targetObjectCode: 'deals' }] },
        { actions: null },
        {},
      ]),
    ).toEqual(['contacts', 'deals']);
  });

  it('ignores malformed actions while collecting Target Object codes', () => {
    expect(
      collectActionTargetObjectCodes([
        {
          actions: [
            'nonsense',
            null,
            { type: 'CREATE_RECORD' },
            { type: 'CREATE_RECORD', targetObjectCode: 42 },
            { type: 'CREATE_RECORD', targetObjectCode: '   ' },
            { type: 'CREATE_RECORD', targetObjectCode: ' contacts ' },
          ],
        },
      ]),
    ).toEqual(['contacts']);
    expect(collectActionTargetObjectCodes(null)).toEqual([]);
    expect(collectActionTargetObjectCodes(undefined)).toEqual([]);
  });

  it('keeps cross-object rules out of the draft validator', () => {
    // `published-object.service.ts` parses every ALREADY PUBLISHED snapshot
    // through `validateTransitionActions()` and maps a parse failure to
    // INTERNAL_ERROR, so a cross-object rule added to the draft validator would
    // turn every runtime read of an action-bearing object into a 500. The same
    // draft the analyzer blocks must therefore pass the draft validator.
    expect(() =>
      validateWorkflowDraft(
        {
          isEnabled: true,
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
              allowedRoles: ['TENANT_ADMIN'],
              requiredFieldKeys: [],
              sortOrder: 10,
              actions: [
                {
                  key: 'create-contact',
                  type: 'CREATE_RECORD',
                  // No such object exists, and the copy is TEXT→MONEY.
                  targetObjectCode: 'ghost',
                  values: {
                    amount: { source: 'SOURCE_FIELD', fieldKey: 'name' },
                  },
                },
                {
                  key: 'assign-actor',
                  type: 'ASSIGN_OWNER',
                  target: 'SOURCE_RECORD',
                  owner: { source: 'ACTOR' },
                },
              ],
            },
          ],
        },
        { knownFieldKeys: ['name'] },
      ),
    ).not.toThrow();
  });
});
