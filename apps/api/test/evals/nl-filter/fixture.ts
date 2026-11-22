import type { TenantContext } from '../../../src/common/tenancy/tenant-context';
import type {
  PublishedField,
  PublishedObjectSchema,
} from '../../../src/modules/objects/object-schema';
import { PublishedObjectService } from '../../../src/modules/objects/published-object.service';
import type { RecordsStore } from '../../../src/modules/records/records.repository';

export const now = new Date('2026-11-22T16:00:00Z');
export const zone = 'Asia/Shanghai';
export const actor: TenantContext = {
  userId: 'eval-user',
  tenantId: 'eval-tenant',
  tenantCode: 'eval',
  memberId: '11000000-0000-4000-a000-000000000001',
  role: 'EMPLOYEE',
};

function field(
  fieldKey: string,
  label: string,
  type: PublishedField['type'],
  options?: string[][],
): PublishedField {
  return {
    fieldKey,
    label,
    type,
    id: fieldKey,
    required: false,
    sortOrder: 0,
    defaultValue: null,
    validation: {},
    isSystem: false,
    config: options
      ? {
          options: options.map(([key, label, status = 'ACTIVE']) => ({
            key,
            label,
            status,
          })),
        }
      : {},
  };
}
const fields = [
  field('stage', '阶段', 'SINGLE_SELECT', [
    ['quote', '报价'],
    ['negotiation', '谈判'],
    ['won', '成交'],
    ['shelved', '已搁置', 'INACTIVE'],
  ]),
  field('amount', '预计金额', 'MONEY'),
  field('contacted', '联系日期', 'DATE'),
  field('level', '客户等级', 'SINGLE_SELECT', [
    ['a', '重点'],
    ['b', '普通'],
  ]),
  field('size', '客户规模', 'SINGLE_SELECT', [
    ['large', '大型'],
    ['small', '小型'],
  ]),
  field('secretMargin', '内部毛利', 'MONEY'),
];
const schema: PublishedObjectSchema = {
  publication: {
    id: 'publication',
    number: 1,
    sourceDraftVersion: 1,
    publishedAt: '2026-11-01T00:00:00Z',
  },
  object: {
    id: 'object',
    code: 'customers',
    name: '客户',
    description: null,
    titleFieldKey: 'stage',
    icon: null,
    sortOrder: 0,
  },
  fields,
  defaultView: {
    code: 'default',
    name: '默认',
    columnFieldKeys: ['stage'],
    sort: { field: 'updatedAt', direction: 'desc' },
  },
  employeeAccess: {
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    readScope: 'OWN',
    updateScope: 'NONE',
    fields: Object.fromEntries(
      fields.map((f) => [
        f.fieldKey,
        f.fieldKey === 'secretMargin' ? 'HIDDEN' : 'READ_ONLY',
      ]),
    ),
  },
};
export const outOfScopeMember = '4abc0000-0000-4000-a000-000000000099';
export const objects = new PublishedObjectService({
  list: () => Promise.resolve([]),
  findByCode: (context, code) =>
    Promise.resolve(
      context.tenantId === actor.tenantId && code === 'customers'
        ? {
            id: schema.object.id,
            code,
            status: 'ACTIVE',
            sortOrder: 0,
            configuration: schema,
            memberId: context.memberId,
          }
        : null,
    ),
});
export const store = {
  resolveCurrentObject: () => objects.resolveRuntimeSchema(actor, 'customers'),
  getTenantTimezone: () => Promise.resolve(zone),
  memberExists: (id: string) =>
    Promise.resolve(id === actor.memberId || id === outOfScopeMember),
} satisfies Partial<RecordsStore>;
