import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { PublishedObjectSchema } from '../../objects/object-schema';
import type {
  PublishedObjectRecord,
  PublishedObjectRepository,
} from '../../objects/published-object.repository';
import { PublishedObjectService } from '../../objects/published-object.service';
import type { RecordActivity } from '../../records/record-activity';
import type {
  DynamicRecord,
  RecordListQuery,
  RecordsRepository,
  RecordsStore,
} from '../../records/records.repository';
import { RecordsService } from '../../records/records.service';

export const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'baijie',
  memberId: '018f47a2-4b5c-7d8e-9f01-111111111111',
  role: 'TENANT_ADMIN',
};

export const employee: TenantContext = {
  ...admin,
  userId: 'user-employee',
  memberId: '018f47a2-4b5c-7d8e-9f01-222222222222',
  role: 'EMPLOYEE',
};

export const otherMemberId = '018f47a2-4b5c-7d8e-9f01-333333333333';
export const ownRecordId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
export const otherRecordId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const missingRecordId = '11111111-1111-4111-8111-111111111111';

export const ACTOR_OVERRIDE_KEYS = {
  tenantId: 'other-tenant',
  memberId: 'other-member',
  userId: 'other-user',
  role: 'TENANT_ADMIN' as const,
  readScope: 'ALL',
  includeHidden: true,
  bypassPermission: true,
  runAsAdmin: true,
};

function publishedSchema(): PublishedObjectSchema {
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
        validation: { maxLength: 100 },
        config: {},
        sortOrder: 10,
        isSystem: false,
      },
      {
        id: 'field-secret',
        fieldKey: 'secret',
        label: '内部备注',
        type: 'TEXTAREA',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 30,
        isSystem: false,
      },
    ],
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
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { name: 'EDIT', secret: 'HIDDEN' },
    },
  };
}

class MemoryPublishedRepository implements PublishedObjectRepository {
  readonly record: PublishedObjectRecord = {
    id: 'object-leads',
    code: 'leads',
    status: 'ACTIVE',
    sortOrder: 10,
    configuration: publishedSchema(),
  };

  list(): Promise<PublishedObjectRecord[]> {
    return Promise.resolve([structuredClone(this.record)]);
  }

  findByCode(_context: TenantContext, code: string) {
    return Promise.resolve(
      code === this.record.code ? structuredClone(this.record) : null,
    );
  }
}

class MemoryRecordsStore {
  records: DynamicRecord[] = [];
  activities: RecordActivity[] = [];

  memberExists(): Promise<boolean> {
    return Promise.resolve(true);
  }

  listRecords(query: RecordListQuery) {
    const filtered = this.records.filter(
      (record) =>
        record.objectId === query.objectId &&
        record.deletedAt === null &&
        (!query.ownerMemberId || record.ownerMemberId === query.ownerMemberId),
    );
    return Promise.resolve({ items: structuredClone(filtered), total: filtered.length });
  }

  findRecord(objectId: string, recordId: string): Promise<DynamicRecord | null> {
    return Promise.resolve(
      structuredClone(
        this.records.find(
          (record) =>
            record.objectId === objectId &&
            record.id === recordId &&
            record.deletedAt === null,
        ) ?? null,
      ),
    );
  }

  listActivities(
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{ items: RecordActivity[]; total: number }> {
    const filtered = this.activities.filter((activity) => activity.recordId === recordId);
    return Promise.resolve({
      items: structuredClone(filtered.slice(0, query.limit)),
      total: filtered.length,
    });
  }
}

function seedRecord(
  id: string,
  ownerMemberId: string,
  name: string,
  secret: string,
): DynamicRecord {
  return {
    id,
    objectId: 'object-leads',
    recordNo: id === ownRecordId ? 1n : 2n,
    ownerMemberId,
    workflowStateKey: null,
    title: name,
    values: { name, secret },
    version: 1,
    createdByMemberId: ownerMemberId,
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
    deletedAt: null,
  };
}

export function recordToolFixture(
  access: {
    readScope?: 'ALL' | 'OWN' | 'NONE';
    canRead?: boolean;
  } = {},
) {
  const publishedRepository = new MemoryPublishedRepository();
  const configuration = publishedRepository.record
    .configuration as PublishedObjectSchema;
  if (access.readScope) configuration.employeeAccess.readScope = access.readScope;
  if (access.canRead !== undefined) configuration.employeeAccess.canRead = access.canRead;
  const store = new MemoryRecordsStore();
  store.records = [
    seedRecord(ownRecordId, employee.memberId, '自己的线索', '仅管理员可见'),
    seedRecord(otherRecordId, otherMemberId, '别人的线索', '别人的机密'),
  ];
  store.activities = [
    {
      id: 'activity-own',
      recordId: ownRecordId,
      activityType: 'NOTE',
      content: '自己的跟进',
      nextActionAt: null,
      actorMemberId: employee.memberId,
      actorDisplayName: '员工',
      createdAt: '2026-08-21T10:30:00.000Z',
    },
    {
      id: 'activity-other',
      recordId: otherRecordId,
      activityType: 'CALL',
      content: '别人的跟进',
      nextActionAt: null,
      actorMemberId: otherMemberId,
      actorDisplayName: '其他成员',
      createdAt: '2026-08-21T10:31:00.000Z',
    },
  ];
  const records = new RecordsService(
    {
      withTenant(_context, work) {
        return work(store as unknown as RecordsStore);
      },
    } as RecordsRepository,
    new PublishedObjectService(publishedRepository),
    () => new Date('2026-08-21T10:30:00.000Z'),
    () => 'generated-id',
  );
  return { records, store, publishedRepository };
}
