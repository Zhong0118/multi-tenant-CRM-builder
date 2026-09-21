import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type {
  PublishedObjectService,
  ResolvedObjectSchema,
} from '../../objects/published-object.service';
import { createDescribeObjectTool } from './describe-object.tool';

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-a',
  memberId: 'member-a',
  role: 'EMPLOYEE',
};

function publishedObjects(
  resolveRuntimeSchema: PublishedObjectService['resolveRuntimeSchema'],
): PublishedObjectService {
  return { resolveRuntimeSchema } as PublishedObjectService;
}

function resolvedSchema(): ResolvedObjectSchema {
  return {
    schema: {
      publication: {
        id: 'pub-1',
        number: 3,
        sourceDraftVersion: 9,
        publishedAt: '2026-08-21T10:00:00.000Z',
      },
      object: {
        id: 'object-leads',
        code: 'leads',
        name: '线索',
        description: 'internal',
        titleFieldKey: 'name',
        icon: 'contacts',
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
          id: 'field-phone',
          fieldKey: 'phone',
          label: '手机号',
          type: 'PHONE',
          required: false,
          defaultValue: null,
          validation: {},
          config: {},
          sortOrder: 20,
          isSystem: false,
        },
        {
          id: 'field-stage',
          fieldKey: 'stage',
          label: '阶段',
          type: 'SINGLE_SELECT',
          required: false,
          defaultValue: null,
          validation: {},
          config: {
            options: [
              { key: 'new', label: '新建' },
              { key: 'won', label: '成交' },
            ],
          },
          sortOrder: 30,
          isSystem: false,
        },
      ],
      defaultView: {
        code: 'default',
        name: '全部线索',
        columnFieldKeys: ['name', 'phone', 'stage'],
        sort: { field: 'updatedAt', direction: 'desc' },
      },
      employeeAccess: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
        fields: { name: 'EDIT', phone: 'HIDDEN', stage: 'READ_ONLY' },
      },
    },
    access: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { name: 'EDIT', phone: 'HIDDEN', stage: 'READ_ONLY' },
    },
    visibleSchema: {
      publication: { number: 3, publishedAt: '2026-08-21T10:00:00.000Z' },
      object: {
        code: 'leads',
        name: '线索',
        description: 'internal',
        titleFieldKey: 'name',
        icon: 'contacts',
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
          access: 'EDIT',
        },
        {
          id: 'field-stage',
          fieldKey: 'stage',
          label: '阶段',
          type: 'SINGLE_SELECT',
          required: false,
          defaultValue: null,
          validation: {},
          config: {
            options: [
              { key: 'new', label: '新建' },
              { key: 'won', label: '成交' },
            ],
          },
          sortOrder: 30,
          isSystem: false,
          access: 'READ_ONLY',
        },
      ],
      defaultView: {
        code: 'default',
        name: '全部线索',
        columnFieldKeys: ['name', 'stage'],
        sort: { field: 'updatedAt', direction: 'desc' },
      },
      actions: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
      scopes: { read: 'OWN', update: 'OWN' },
    },
  };
}

describe('describe_object', () => {
  it('requires objectCode and rejects actor-override keys', () => {
    const tool = createDescribeObjectTool(
      publishedObjects(jest.fn()),
      context,
    );
    expect(tool.inputSchema.safeParse({ objectCode: 'leads' }).success).toBe(
      true,
    );
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        objectCode: 'leads',
        tenantId: 'x',
        includeHidden: true,
        runAsAdmin: true,
      }).success,
    ).toBe(false);
  });

  it('projects only visible fields for the injected actor', async () => {
    const resolveRuntimeSchema = jest.fn().mockResolvedValue(resolvedSchema());
    const tool = createDescribeObjectTool(
      publishedObjects(resolveRuntimeSchema),
      context,
    );

    const result = await tool.execute({ objectCode: 'leads' }, 'call-1');

    expect(resolveRuntimeSchema).toHaveBeenCalledWith(context, 'leads');
    expect(result).toEqual({
      object: { code: 'leads', name: '线索' },
      fields: [
        { fieldKey: 'name', label: '姓名', type: 'TEXT', required: true },
        {
          fieldKey: 'stage',
          label: '阶段',
          type: 'SINGLE_SELECT',
          required: false,
          options: [
            { key: 'new', label: '新建' },
            { key: 'won', label: '成交' },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /phone|HIDDEN|memberOverride|employeeAccess|access|icon|sortOrder|scopes/,
    );
  });
});
