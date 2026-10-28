import type {
  PublishedField,
  PublishedObjectSchema,
} from '../objects/object-schema';
import { resolvePublishedObjectRecord } from '../objects/published-object.service';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { previewAutomation, type AutomationSession } from './automation-runner';
import type { AutomationRule } from './automation.types';

jest.mock('../objects/published-object-transaction', () => ({
  resolvePublishedObjectInTransaction: jest.fn(),
}));

function fixture() {
  const field = (
    fieldKey: string,
    type: PublishedField['type'],
    defaultValue: PublishedField['defaultValue'] = null,
  ): PublishedField => ({
    id: fieldKey,
    fieldKey,
    label: fieldKey,
    type,
    required: false,
    defaultValue,
    validation: {},
    config: {
      options: [
        { key: 'option_1', label: '选题' },
        { key: 'option_2', label: '投稿' },
        { key: 'option_3', label: '返修' },
      ],
    },
    sortOrder: 0,
    isSystem: false,
  });
  const schema: PublishedObjectSchema = {
    publication: {
      id: 'publication',
      number: 1,
      sourceDraftVersion: 1,
      publishedAt: '2026-10-28T00:00:00Z',
    },
    object: {
      id: 'orders',
      code: 'orders',
      name: '开单',
      titleFieldKey: 'name',
      description: null,
      icon: null,
      sortOrder: 0,
    },
    fields: [
      field('name', 'TEXT', '测试客户'),
      field('status', 'SINGLE_SELECT', 'option_1'),
      field('tags', 'MULTI_SELECT', ['option_2', 'option_3']),
      field('secret', 'SINGLE_SELECT', 'option_1'),
      field('empty', 'SINGLE_SELECT'),
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
      fields: {
        name: 'EDIT',
        status: 'EDIT',
        tags: 'EDIT',
        secret: 'HIDDEN',
        empty: 'EDIT',
      },
    },
  };
  const resolved = resolvePublishedObjectRecord(
    {
      id: 'orders',
      code: 'orders',
      status: 'ACTIVE',
      sortOrder: 0,
      configuration: schema,
    },
    'EMPLOYEE',
  );
  const session: AutomationSession = {
    tx: {} as AutomationSession['tx'],
    store: {} as AutomationSession['store'],
    audit: {} as AutomationSession['audit'],
    context: {
      tenantId: 'tenant',
      tenantCode: 'company',
      memberId: 'employee',
      userId: 'user',
      role: 'EMPLOYEE',
    },
    resolved,
    source: {
      id: 'customer',
      objectId: 'customers',
      recordNo: 1n,
      ownerMemberId: 'employee',
      workflowStateKey: null,
      title: '测试客户',
      values: { status: 'option_1', tags: ['option_2', 'option_3'] },
      version: 1,
      createdByMemberId: 'employee',
      createdAt: '2026-10-28T00:00:00Z',
      updatedAt: '2026-10-28T00:00:00Z',
      deletedAt: null,
    },
  };
  const rule: AutomationRule = {
    key: 'create-order',
    label: '新建关联开单',
    enabled: true,
    allowedRoles: ['EMPLOYEE'],
    trigger: { type: 'MANUAL' },
    targetObjectCode: 'orders',
    owner: 'ACTOR',
    mappings: {},
  };
  jest.mocked(resolvePublishedObjectInTransaction).mockResolvedValue(resolved);
  return { session, rule };
}

describe('automation preview choice labels', () => {
  it.each(['INPUT', 'SOURCE_FIELD', 'LITERAL', 'DEFAULT'] as const)(
    'labels visible single/multi-select %s values without changing stored keys or exposing hidden fields',
    async (source) => {
      const { session, rule } = fixture();
      const values = { status: 'option_1', tags: ['option_2', 'option_3'] };
      for (const [key, value] of Object.entries(values)) {
        if (source === 'DEFAULT') continue;
        rule.mappings[key] =
          source === 'SOURCE_FIELD'
            ? { source, fieldKey: key }
            : source === 'LITERAL'
              ? { source, value }
              : { source };
      }
      const preview = await previewAutomation(
        session,
        rule,
        source === 'INPUT' ? values : {},
      );
      expect(preview.values).toEqual({ name: '测试客户', ...values });
      expect(preview).toMatchObject({
        valueLabels: { status: '选题', tags: '投稿；返修' },
      });
      expect(Object.keys(preview.valueLabels).sort()).toEqual([
        'status',
        'tags',
      ]);
      expect(preview.fieldLabels).not.toHaveProperty('secret');
    },
  );

  it('keeps empty choices available for the existing display fallback', async () => {
    const { session, rule } = fixture();
    rule.mappings = { status: { source: 'INPUT' }, tags: { source: 'INPUT' } };
    const preview = await previewAutomation(session, rule, {
      status: null,
      tags: [],
    });
    expect(preview.values).toMatchObject({ status: null, tags: [] });
    expect(preview).toMatchObject({ valueLabels: { tags: '' } });
  });
});
