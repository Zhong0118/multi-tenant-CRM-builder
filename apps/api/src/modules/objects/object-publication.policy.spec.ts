import {
  analyzePublication,
  compilePublication,
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
      states: [
        { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      ],
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
