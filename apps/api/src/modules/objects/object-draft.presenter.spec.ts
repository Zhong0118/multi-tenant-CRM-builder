import { toObjectDraftResponse } from './object-draft.presenter';
import type { ObjectDraft } from './objects.repository';
import type { PublishedObjectSchema } from './object-schema';

function publishedSchema(
  overrides: Partial<PublishedObjectSchema> = {},
): PublishedObjectSchema {
  return {
    publication: {
      id: 'publication-1',
      number: 2,
      sourceDraftVersion: 4,
      publishedAt: '2026-08-20T00:00:00.000Z',
    },
    object: {
      id: 'object-1',
      code: 'customers',
      name: '客户资料',
      description: null,
      titleFieldKey: 'customer_name',
      icon: null,
      sortOrder: 10,
    },
    fields: [
      {
        id: 'field-name',
        fieldKey: 'customer_name',
        label: '客户名称',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
      },
    ],
    defaultView: {
      code: 'default',
      name: '默认视图',
      columnFieldKeys: ['customer_name'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { customer_name: 'EDIT' },
    },
    ...overrides,
  };
}

function draft(overrides: Partial<ObjectDraft> = {}): ObjectDraft {
  return {
    object: {
      id: 'object-1',
      code: 'customers',
      name: '客户资料',
      description: null,
      titleFieldKey: 'customer_name',
      icon: null,
      sortOrder: 10,
      version: 4,
      status: 'ACTIVE',
      activePublicationId: 'publication-1',
      publishedAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    fields: [
      {
        id: 'field-name',
        fieldKey: 'customer_name',
        label: '客户名称',
        type: 'TEXT',
        required: true,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
        status: 'ACTIVE',
      },
    ],
    defaultView: {
      code: 'default',
      name: '默认视图',
      columnFieldKeys: ['customer_name'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { customer_name: 'EDIT' },
    },
    activeSchema: publishedSchema(),
    activeRecordCount: 12,
    ...overrides,
  };
}

describe('toObjectDraftResponse', () => {
  it('reports a published object whose draft matches the live version as unchanged', () => {
    const response = toObjectDraftResponse(draft());

    expect(response.object.status).toBe('ACTIVE');
    expect(response.object.publicationNumber).toBe(2);
    expect(response.object.hasUnpublishedChanges).toBe(false);
    expect(response.activeRecordCount).toBe(12);
    expect(response.defaultView).not.toHaveProperty('searchFieldKeys');
  });

  it('exposes configured searchFieldKeys on the designer default view', () => {
    const response = toObjectDraftResponse(
      draft({
        defaultView: {
          ...draft().defaultView!,
          searchFieldKeys: ['customer_name'],
        },
      }),
    );

    expect(response.defaultView?.searchFieldKeys).toEqual(['customer_name']);
  });

  it('reports unpublished changes once the draft version moves past the live publication', () => {
    const response = toObjectDraftResponse(
      draft({
        object: { ...draft().object, version: 6 },
      }),
    );

    expect(response.object.hasUnpublishedChanges).toBe(true);
  });

  it('treats a never-published object as having no live publication', () => {
    const response = toObjectDraftResponse(
      draft({
        object: {
          ...draft().object,
          status: 'DRAFT',
          activePublicationId: null,
          publishedAt: null,
        },
        activeSchema: null,
      }),
    );

    expect(response.object.publicationNumber).toBeNull();
    expect(response.object.hasUnpublishedChanges).toBe(true);
    expect(response.fields[0].publishedType).toBeNull();
  });

  it('locks the type of a field that is already published and leaves a new field open', () => {
    const base = draft();
    const response = toObjectDraftResponse({
      ...base,
      fields: [
        ...base.fields,
        {
          id: 'field-rating',
          fieldKey: 'rating',
          label: '客户评级',
          type: 'SINGLE_SELECT',
          required: false,
          defaultValue: null,
          validation: {},
          config: {},
          sortOrder: 2,
          isSystem: false,
          status: 'ACTIVE',
        },
      ],
    });

    expect(response.fields[0].publishedType).toBe('TEXT');
    expect(response.fields[1].publishedType).toBeNull();
  });

  /**
   * The designer must never diff the raw snapshot in the browser: reading the
   * published configuration is the API's job, so the response carries derived
   * facts only.
   */
  it('does not ship the raw published snapshot to the client', () => {
    const response = toObjectDraftResponse(draft());

    expect(response).not.toHaveProperty('activeSchema');
    expect(JSON.stringify(response)).not.toContain('sourceDraftVersion');
  });

  it('keeps the draft field order and its inactive state', () => {
    const base = draft();
    const response = toObjectDraftResponse({
      ...base,
      fields: [
        {
          ...base.fields[0],
          fieldKey: 'legacy_note',
          id: 'field-legacy',
          sortOrder: 2,
          status: 'INACTIVE',
        },
        { ...base.fields[0], sortOrder: 1 },
      ],
    });

    expect(response.fields.map((field) => field.fieldKey)).toEqual([
      'customer_name',
      'legacy_note',
    ]);
    expect(response.fields[1].status).toBe('INACTIVE');
  });
});
