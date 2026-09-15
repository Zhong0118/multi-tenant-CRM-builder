import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type {
  PublishedObjectRecord,
  PublishedObjectRepository,
} from '../objects/published-object.repository';
import { PublishedObjectService } from '../objects/published-object.service';
import type { MemberActivityType, RecordActivity } from './record-activity';
import type {
  DynamicRecord,
  RecordListQuery,
  RecordsRepository,
  RecordsStore,
} from './records.repository';
import { RecordsService } from './records.service';

const admin: TenantContext = {
  userId: 'user-admin',
  tenantId: 'tenant-a',
  tenantCode: 'baijie',
  memberId: '018f47a2-4b5c-7d8e-9f01-111111111111',
  role: 'TENANT_ADMIN',
};

const employee: TenantContext = {
  ...admin,
  userId: 'user-employee',
  memberId: '018f47a2-4b5c-7d8e-9f01-222222222222',
  role: 'EMPLOYEE',
};

const otherMemberId = '018f47a2-4b5c-7d8e-9f01-333333333333';
const meta = { requestId: 'req-record', ip: '127.0.0.1' };

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
        id: 'field-email',
        fieldKey: 'email',
        label: '邮箱',
        type: 'EMAIL',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 20,
        isSystem: false,
      },
      {
        id: 'field-status',
        fieldKey: 'lead_status',
        label: '线索状态',
        type: 'SINGLE_SELECT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {
          options: [
            { key: 'new', label: '待联系', status: 'ACTIVE' },
            { key: 'following', label: '跟进中', status: 'ACTIVE' },
          ],
        },
        sortOrder: 25,
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
      {
        id: 'field-tags',
        fieldKey: 'tags',
        label: '标签',
        type: 'MULTI_SELECT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {
          options: [
            { key: 'hot', label: '重点', status: 'ACTIVE' },
            { key: 'nurture', label: '培育', status: 'ACTIVE' },
          ],
        },
        sortOrder: 40,
        isSystem: false,
      },
      {
        id: 'field-follow-up',
        fieldKey: 'follow_up_on',
        label: '下次跟进日',
        type: 'DATE',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 50,
        isSystem: false,
      },
      {
        id: 'field-score',
        fieldKey: 'score',
        label: '评分',
        type: 'NUMBER',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 60,
        isSystem: false,
      },
      {
        id: 'field-quote',
        fieldKey: 'quote',
        label: '报价',
        type: 'MONEY',
        required: false,
        defaultValue: null,
        validation: { scale: 2 },
        config: {},
        sortOrder: 70,
        isSystem: false,
      },
      {
        id: 'field-vip',
        fieldKey: 'is_vip',
        label: '重点客户',
        type: 'BOOLEAN',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 80,
        isSystem: false,
      },
      {
        id: 'field-assignee',
        fieldKey: 'assignee',
        label: '跟进人',
        type: 'MEMBER',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 90,
        isSystem: false,
      },
    ],
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name', 'email'],
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
        email: 'EDIT',
        lead_status: 'EDIT',
        secret: 'HIDDEN',
        tags: 'EDIT',
        follow_up_on: 'EDIT',
        score: 'EDIT',
        quote: 'EDIT',
        is_vip: 'EDIT',
        assignee: 'EDIT',
      },
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

class MemoryRecordsStore implements RecordsStore {
  imports = new Map<string, string>();
  async lockImportBatch() {}
  findImportedRecordId(objectId: string, batchId: string, rowNumber: number) {
    return Promise.resolve(
      this.imports.get(`${objectId}:${batchId}:${rowNumber}`) ?? null,
    );
  }
  saveImportedRecordId(
    objectId: string,
    batchId: string,
    rowNumber: number,
    recordId: string,
  ) {
    this.imports.set(`${objectId}:${batchId}:${rowNumber}`, recordId);
    return Promise.resolve();
  }

  records: DynamicRecord[] = [];
  activities: RecordActivity[] = [];
  members = new Set([admin.memberId, employee.memberId, otherMemberId]);
  audits: AuditEvent[] = [];
  nextRecordNo = 1n;

  memberExists(memberId: string): Promise<boolean> {
    return Promise.resolve(this.members.has(memberId));
  }

  allocateRecordNo(): Promise<bigint> {
    const allocated = this.nextRecordNo;
    this.nextRecordNo += 1n;
    return Promise.resolve(allocated);
  }

  createRecord(record: DynamicRecord): Promise<DynamicRecord> {
    this.records.push(structuredClone(record));
    return Promise.resolve(structuredClone(record));
  }

  listRecords(query: RecordListQuery) {
    const filtered = this.records
      .filter(
        (record) =>
          record.objectId === query.objectId &&
          record.deletedAt === null &&
          (!query.ownerMemberId ||
            record.ownerMemberId === query.ownerMemberId) &&
          matchesSearch(record, query) &&
          query.filters.every((filter) => matchesListFilter(record, filter)),
      )
      .sort((left, right) => compareRecords(left, right, query));
    return Promise.resolve({
      items: structuredClone(
        filtered.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
      ),
      total: filtered.length,
    });
  }

  findRecord(
    objectId: string,
    recordId: string,
  ): Promise<DynamicRecord | null> {
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

  updateRecord(
    recordId: string,
    expectedVersion: number,
    input: {
      values: Record<string, unknown>;
      title: string;
      ownerMemberId: string | null;
    },
  ): Promise<DynamicRecord | null> {
    const record = this.records.find(
      (candidate) => candidate.id === recordId && candidate.deletedAt === null,
    );
    if (!record || record.version !== expectedVersion)
      return Promise.resolve(null);
    record.values = structuredClone(input.values);
    record.title = input.title;
    record.ownerMemberId = input.ownerMemberId;
    record.version += 1;
    record.updatedAt = '2026-08-21T11:00:00.000Z';
    return Promise.resolve(structuredClone(record));
  }

  softDeleteRecord(
    recordId: string,
    expectedVersion: number,
    deletedAt: string,
  ): Promise<boolean> {
    const record = this.records.find(
      (candidate) => candidate.id === recordId && candidate.deletedAt === null,
    );
    if (!record || record.version !== expectedVersion)
      return Promise.resolve(false);
    record.deletedAt = deletedAt;
    record.version += 1;
    return Promise.resolve(true);
  }

  appendAudit(event: AuditEvent): Promise<void> {
    this.audits.push(structuredClone(event));
    return Promise.resolve();
  }

  applyWorkflowTransition(): Promise<null> {
    return Promise.resolve(null);
  }

  listTransitionHistory() {
    return Promise.resolve({ items: [], page: 1, limit: 20, total: 0 });
  }

  listActivities(
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{ items: RecordActivity[]; total: number }> {
    const filtered = this.activities
      .filter((activity) => activity.recordId === recordId)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
    return Promise.resolve({
      items: structuredClone(
        filtered.slice(
          (query.page - 1) * query.limit,
          query.page * query.limit,
        ),
      ),
      total: filtered.length,
    });
  }

  listMemberNames(memberIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>([
      [admin.memberId, '管理员'],
      [employee.memberId, '员工'],
      [otherMemberId, '其他成员'],
    ]);
    return Promise.resolve(
      new Map(
        memberIds.flatMap((memberId) => {
          const name = names.get(memberId);
          return name ? [[memberId, name] as const] : [];
        }),
      ),
    );
  }

  createActivity(activity: {
    id: string;
    recordId: string;
    activityType: MemberActivityType;
    content: string;
    nextActionAt: string | null;
    actorMemberId: string;
    createdAt: string;
  }): Promise<RecordActivity> {
    const created: RecordActivity = {
      id: activity.id,
      recordId: activity.recordId,
      activityType: activity.activityType,
      content: activity.content,
      nextActionAt: activity.nextActionAt,
      actorMemberId: activity.actorMemberId,
      actorDisplayName:
        activity.actorMemberId === admin.memberId ? '管理员' : '员工',
      createdAt: activity.createdAt,
    };
    this.activities.push(structuredClone(created));
    return Promise.resolve(structuredClone(created));
  }
}

class MemoryRecordsRepository implements RecordsRepository {
  constructor(readonly store: MemoryRecordsStore) {}

  withTenant<T>(
    _context: TenantContext,
    work: (store: RecordsStore) => Promise<T>,
  ): Promise<T> {
    return work(this.store);
  }
}

function matchesSearch(record: DynamicRecord, query: RecordListQuery): boolean {
  if (!query.search) return true;
  const needle = query.search.toLowerCase();
  if (record.title.toLowerCase().includes(needle)) return true;
  return query.searchFieldKeys.some((fieldKey) =>
    String(record.values[fieldKey] ?? '')
      .toLowerCase()
      .includes(needle),
  );
}

function matchesListFilter(
  record: DynamicRecord,
  filter: RecordListQuery['filters'][number],
): boolean {
  const value = record.values[filter.fieldKey];
  if (filter.mode === 'DATE_RANGE') {
    if (typeof value !== 'string') return false;
    if (filter.from && value < filter.from) return false;
    if (filter.to && value > filter.to) return false;
    return true;
  }
  if (filter.mode === 'NUMBER_RANGE') {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(numeric)) return false;
    if (filter.min !== undefined && numeric < filter.min) return false;
    if (filter.max !== undefined && numeric > filter.max) return false;
    return true;
  }
  if (filter.mode === 'BOOLEAN_EQUALS') {
    return value === filter.value;
  }
  if (filter.mode === 'MEMBER_EQUALS') {
    return filter.values.includes(String(value));
  }
  if (filter.mode === 'TEXT_CONTAINS') {
    return String(value ?? '')
      .toLowerCase()
      .includes(filter.contains.toLowerCase());
  }
  if (filter.mode === 'EMPTY') return isEmptyFieldValue(value);
  if (filter.mode === 'NOT_EMPTY') return !isEmptyFieldValue(value);
  if (filter.mode === 'CONTAINS') {
    return (
      Array.isArray(value) &&
      filter.values.some((candidate) => value.includes(candidate))
    );
  }
  if (filter.mode === 'EQUALS') {
    return filter.values.includes(String(value));
  }
  return false;
}

function compareRecords(
  left: DynamicRecord,
  right: DynamicRecord,
  query: RecordListQuery,
): number {
  const direction = query.direction === 'asc' ? 1 : -1;
  const compared =
    typeof query.sort === 'string'
      ? compareSystemSort(left, right, query.sort)
      : compareFieldSort(left, right, query.sort);
  if (compared !== 0) return compared * direction;
  return left.id.localeCompare(right.id) * direction;
}

function compareSystemSort(
  left: DynamicRecord,
  right: DynamicRecord,
  sort: 'updatedAt' | 'createdAt' | 'recordNo',
): number {
  const leftValue = sort === 'recordNo' ? left.recordNo : left[sort];
  const rightValue = sort === 'recordNo' ? right.recordNo : right[sort];
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function compareFieldSort(
  left: DynamicRecord,
  right: DynamicRecord,
  sort: Extract<RecordListQuery['sort'], { fieldKey: string }>,
): number {
  const leftValue = left.values[sort.fieldKey];
  const rightValue = right.values[sort.fieldKey];
  if (sort.kind === 'NUMBER') {
    return numericSortValue(leftValue) - numericSortValue(rightValue);
  }
  if (sort.kind === 'OPTION') {
    const keys = sort.optionKeys ?? [];
    return optionSortIndex(leftValue, keys) - optionSortIndex(rightValue, keys);
  }
  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
}

function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function numericSortValue(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
}

function optionSortIndex(value: unknown, keys: string[]): number {
  const index = keys.indexOf(String(value));
  return index === -1 ? keys.length : index;
}

function fixture() {
  const publishedRepository = new MemoryPublishedRepository();
  const publishedObjects = new PublishedObjectService(publishedRepository);
  const store = new MemoryRecordsStore();
  const repository = new MemoryRecordsRepository(store);
  let id = 0;
  const service = new RecordsService(
    repository,
    publishedObjects,
    () => new Date('2026-08-21T10:30:00.000Z'),
    () => `record-${++id}`,
  );
  return { service, store, publishedRepository };
}

async function create(
  service: RecordsService,
  context: TenantContext,
  name: string,
  ownerMemberId?: string,
  extraValues: Record<string, unknown> = {},
) {
  return service.create(
    context,
    'leads',
    { values: { name, ...extraValues }, ownerMemberId },
    meta,
  );
}

describe('RecordsService', () => {
  it('reuses successful import rows after a lost response while corrected failures can succeed', async () => {
    const { service, store } = fixture();
    const batchId = '2a7a955c-bf19-4a1d-8cdf-4a94a20bb082';
    const first = await service.importRows(
      admin,
      'leads',
      {
        batchId,
        rows: [
          { rowNumber: 2, values: { name: 'One' } },
          { rowNumber: 3, values: {} },
        ],
      },
      meta,
    );
    expect(first.created).toBe(1);
    const retry = await service.importRows(
      admin,
      'leads',
      {
        batchId,
        rows: [
          { rowNumber: 2, values: { name: 'Changed successful row' } },
          { rowNumber: 3, values: { name: 'Corrected' } },
        ],
      },
      meta,
    );
    expect(retry.items[0].record?.id).toBe(first.items[0].record?.id);
    expect(retry.items[0].record?.title).toBe('One');
    expect(store.records).toHaveLength(2);
    expect(retry.failed).toBe(0);
  });

  it('preserves another owner when an employee with UPDATE ALL edits values', async () => {
    const { service, publishedRepository } = fixture();
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.employeeAccess.readScope = 'ALL';
    configuration.employeeAccess.updateScope = 'ALL';
    const record = await create(service, admin, 'Original', otherMemberId);
    const updated = await service.update(
      employee,
      'leads',
      record.id,
      { version: record.version, values: { name: 'Edited' } },
      meta,
    );
    expect(updated.ownerMemberId).toBe(otherMemberId);
  });
  it('denies runtime access and navigation when an existing title is hidden', async () => {
    const { service, publishedRepository } = fixture();
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.employeeAccess.fields.name = 'HIDDEN';
    await expect(
      service.list(employee, 'leads', {
        page: 1,
        limit: 20,
        sort: 'updatedAt',
        direction: 'desc',
        search: 'secret',
      }),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    await expect(
      new PublishedObjectService(publishedRepository).listAccessible(employee),
    ).resolves.toEqual([]);
  });

  it('initializes new records with the published workflow initial state', async () => {
    const { service, store, publishedRepository } = fixture();
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.workflow = {
      initialStateKey: 'new',
      states: [
        { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
      ],
      transitions: [],
    };

    await create(service, admin, '新线索');
    expect(store.records[0]?.workflowStateKey).toBe('new');
  });

  it('leaves workflow state empty when the object has no workflow', async () => {
    const { service, store } = fixture();
    await create(service, admin, '普通线索');
    expect(store.records[0]?.workflowStateKey).toBeNull();
  });

  it('ignores a client-supplied workflowStateKey on create', async () => {
    const { service, store, publishedRepository } = fixture();
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.workflow = {
      initialStateKey: 'new',
      states: [
        { key: 'new', label: '新建', sortOrder: 10, isTerminal: false },
        { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
      ],
      transitions: [],
    };

    await expect(
      service.create(
        admin,
        'leads',
        {
          values: { name: '恶意状态', workflowStateKey: 'won' },
        },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'FIELD_UNKNOWN' });
    expect(store.records).toEqual([]);
  });

  it('enforces CREATE action permission', async () => {
    const { service, publishedRepository } = fixture();
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.employeeAccess.canCreate = false;

    await expect(create(service, employee, '张三')).rejects.toMatchObject({
      code: 'OBJECT_ACTION_FORBIDDEN',
    });
  });

  it('validates an admin-selected owner and forces employee ownership to self', async () => {
    const { service } = fixture();

    await expect(
      create(
        service,
        admin,
        '无效负责人',
        '018f47a2-4b5c-7d8e-9f01-999999999999',
      ),
    ).rejects.toMatchObject({ code: 'OWNER_INVALID' });
    await expect(
      create(service, employee, '员工线索', otherMemberId),
    ).resolves.toMatchObject({ ownerMemberId: employee.memberId });
  });

  it('enforces OWN scope for list, detail, and update', async () => {
    const { service } = fixture();
    const own = await create(
      service,
      admin,
      '员工自己的线索',
      employee.memberId,
    );
    const other = await create(service, admin, '其他人的线索', otherMemberId);

    const page = await service.list(employee, 'leads', {
      page: 1,
      limit: 20,
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(page.items.map((record) => record.id)).toEqual([own.id]);
    await expect(
      service.detail(employee, 'leads', own.id),
    ).resolves.toMatchObject({
      id: own.id,
    });
    await expect(
      service.detail(employee, 'leads', other.id),
    ).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
    await expect(
      service.update(
        employee,
        'leads',
        other.id,
        { version: other.version, values: { name: '伪造修改' } },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('uses stable pagination, title search, owner filter, and requested sort', async () => {
    const { service } = fixture();
    await create(service, admin, 'Beta', employee.memberId);
    await create(service, admin, 'Alpha', employee.memberId);
    await create(service, admin, 'Other', otherMemberId);

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 1,
      search: 'a',
      ownerMemberId: employee.memberId,
      sort: 'recordNo',
      direction: 'asc',
    });
    expect(page).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(page.items.map((record) => record.title)).toEqual(['Beta']);
  });

  it('filters real records by a visible published single-select field', async () => {
    const { service } = fixture();
    await create(service, admin, '甲线索', employee.memberId, {
      lead_status: 'new',
    });
    await create(service, admin, '乙线索', employee.memberId, {
      lead_status: 'following',
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"lead_status":["following"]}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.total).toBe(1);
    expect(page.items.map((record) => record.title)).toEqual(['乙线索']);
  });

  it('searches visible default-view text fields without scanning hidden values', async () => {
    const { service } = fixture();
    await create(service, admin, '公开标题', employee.memberId, {
      email: 'alpha@example.com',
      secret: '机密标记',
    });
    await create(service, admin, '另一条', employee.memberId, {
      email: 'beta@example.com',
      secret: '无关',
    });

    const byEmail = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      search: 'alpha@',
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(byEmail.items.map((record) => record.title)).toEqual(['公开标题']);

    const hidden = await service.list(employee, 'leads', {
      page: 1,
      limit: 20,
      search: '机密标记',
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(hidden.total).toBe(0);
  });

  it('searches extra default-view text fields that are not list columns, without scanning hidden values', async () => {
    const { service, publishedRepository } = fixture();
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.fields.push({
      id: 'field-phone',
      fieldKey: 'phone',
      label: '联系电话',
      type: 'PHONE',
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 22,
      isSystem: false,
    });
    configuration.employeeAccess.fields.phone = 'EDIT';
    Object.assign(configuration.defaultView, {
      searchFieldKeys: ['phone', 'secret'],
    });

    await create(service, admin, '公开标题', employee.memberId, {
      phone: '13800138000',
      secret: '机密标记',
    });
    await create(service, admin, '另一条', employee.memberId, {
      phone: '13900139000',
      secret: '无关',
    });

    const byPhone = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      search: '13800138',
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(byPhone.items.map((record) => record.title)).toEqual(['公开标题']);

    const hidden = await service.list(employee, 'leads', {
      page: 1,
      limit: 20,
      search: '机密标记',
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(hidden.total).toBe(0);
  });

  it('filters records by a visible published multi-select field', async () => {
    const { service } = fixture();
    await create(service, admin, '重点线索', employee.memberId, {
      tags: ['hot'],
    });
    await create(service, admin, '培育线索', employee.memberId, {
      tags: ['nurture'],
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"tags":["hot"]}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['重点线索']);
  });

  it('filters records by a visible published date range', async () => {
    const { service } = fixture();
    await create(service, admin, '八月跟进', employee.memberId, {
      follow_up_on: '2026-08-10',
    });
    await create(service, admin, '九月跟进', employee.memberId, {
      follow_up_on: '2026-09-01',
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"follow_up_on":{"from":"2026-08-01","to":"2026-08-31"}}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['八月跟进']);
  });

  it('filters records by a visible published number range', async () => {
    const { service } = fixture();
    await create(service, admin, '低分', employee.memberId, { score: 12 });
    await create(service, admin, '高分', employee.memberId, { score: 88 });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"score":{"min":50,"max":100}}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['高分']);
  });

  it('filters records by a visible published money range', async () => {
    const { service } = fixture();
    await create(service, admin, '小额', employee.memberId, { quote: '80.00' });
    await create(service, admin, '大额', employee.memberId, {
      quote: '320.50',
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"quote":{"min":100,"max":400}}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['大额']);
  });

  it('filters records by a visible published boolean field', async () => {
    const { service } = fixture();
    await create(service, admin, '重点', employee.memberId, { is_vip: true });
    await create(service, admin, '普通', employee.memberId, { is_vip: false });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"is_vip":true}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['重点']);
  });

  it('filters records by a visible published member field', async () => {
    const { service } = fixture();
    await create(service, admin, '员工跟进', employee.memberId, {
      assignee: employee.memberId,
    });
    await create(service, admin, '他人跟进', employee.memberId, {
      assignee: otherMemberId,
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: `{"assignee":["${employee.memberId}"]}`,
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['员工跟进']);
  });

  it('filters records by a visible published text contains value', async () => {
    const { service } = fixture();
    await create(service, admin, '甲线索', employee.memberId, {
      email: 'alpha@corp.com',
    });
    await create(service, admin, '乙线索', employee.memberId, {
      email: 'beta@other.com',
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"email":{"contains":"corp.com"}}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['甲线索']);
  });

  it('filters records by empty or not-empty published fields', async () => {
    const { service } = fixture();
    await create(service, admin, '有邮箱', employee.memberId, {
      email: 'alpha@corp.com',
    });
    await create(service, admin, '无邮箱', employee.memberId);

    const filled = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"email":{"presence":"not_empty"}}',
      sort: 'updatedAt',
      direction: 'desc',
    });
    const empty = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"email":{"presence":"empty"}}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(filled.items.map((record) => record.title)).toEqual(['有邮箱']);
    expect(empty.items.map((record) => record.title)).toEqual(['无邮箱']);
  });

  it('filters records by a published relative date window', async () => {
    const { service } = fixture();
    await create(service, admin, '上周跟进', employee.memberId, {
      follow_up_on: '2026-08-10',
    });
    await create(service, admin, '本周跟进', employee.memberId, {
      follow_up_on: '2026-08-20',
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"follow_up_on":{"relative":"past_7_days"}}',
      sort: 'updatedAt',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['本周跟进']);
  });

  it('applies published filters while sorting by a typed field', async () => {
    const { service } = fixture();
    await create(service, admin, '低分重点', employee.memberId, {
      score: 12,
      is_vip: true,
    });
    await create(service, admin, '高分普通', employee.memberId, {
      score: 88,
      is_vip: false,
    });
    await create(service, admin, '高分重点', employee.memberId, {
      score: 90,
      is_vip: true,
    });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      filters: '{"is_vip":true}',
      sort: 'score',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual([
      '高分重点',
      '低分重点',
    ]);
  });

  it('sorts records by a visible published number field', async () => {
    const { service } = fixture();
    await create(service, admin, '低分', employee.memberId, { score: 12 });
    await create(service, admin, '高分', employee.memberId, { score: 88 });

    const page = await service.list(admin, 'leads', {
      page: 1,
      limit: 20,
      sort: 'score',
      direction: 'desc',
    });

    expect(page.items.map((record) => record.title)).toEqual(['高分', '低分']);
  });

  it('rejects sorting on a hidden or unsortable field', async () => {
    const { service } = fixture();

    await expect(
      service.list(employee, 'leads', {
        page: 1,
        limit: 20,
        sort: 'secret',
        direction: 'asc',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_SORT_INVALID' });
    await expect(
      service.list(employee, 'leads', {
        page: 1,
        limit: 20,
        sort: 'tags',
        direction: 'asc',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_SORT_INVALID' });
  });

  it('rejects filters on hidden or non-select fields', async () => {
    const { service } = fixture();

    await expect(
      service.list(employee, 'leads', {
        page: 1,
        limit: 20,
        filters: '{"secret":["anything"]}',
        sort: 'updatedAt',
        direction: 'desc',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_FILTER_INVALID' });
    await expect(
      service.list(employee, 'leads', {
        page: 1,
        limit: 20,
        filters: '{"name":["甲线索"]}',
        sort: 'updatedAt',
        direction: 'desc',
      }),
    ).rejects.toMatchObject({ code: 'RECORD_FILTER_INVALID' });
  });

  it('normalizes writes, hides response fields, and retains server values in audit', async () => {
    const { service, store } = fixture();
    const created = await create(service, admin, '张三', employee.memberId, {
      email: 'USER@EXAMPLE.COM',
      secret: '仅管理员可见',
    });
    expect(created.values).toEqual({
      name: '张三',
      email: 'user@example.com',
      secret: '仅管理员可见',
    });

    const visible = await service.detail(employee, 'leads', created.id);
    expect(visible.values).toEqual({ name: '张三', email: 'user@example.com' });
    const updated = await service.update(
      employee,
      'leads',
      created.id,
      { version: created.version, values: { name: '张三（更新）' } },
      meta,
    );
    expect(updated.values).toEqual({
      name: '张三（更新）',
      email: 'user@example.com',
    });
    const updateAudit = store.audits.find(
      (event) => event.action === 'record.updated',
    );
    expect(updateAudit?.after).toMatchObject({
      values: {
        name: '张三（更新）',
        email: 'user@example.com',
        secret: '仅管理员可见',
      },
    });
  });

  it('batch-updates selected records and reports per-row failures', async () => {
    const { service } = fixture();
    const first = await create(service, employee, '甲线索');
    const second = await create(service, employee, '乙线索');
    const foreign = await create(service, admin, '别人的线索', otherMemberId);

    const result = await service.batchUpdate(
      employee,
      'leads',
      {
        items: [
          { recordId: first.id, version: first.version },
          { recordId: second.id, version: second.version + 1 },
          { recordId: foreign.id, version: foreign.version },
        ],
        values: { lead_status: 'following' },
      },
      meta,
    );

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.items[0]).toMatchObject({
      recordId: first.id,
      status: 'UPDATED',
    });
    expect(result.items[1]).toMatchObject({
      recordId: second.id,
      status: 'FAILED',
      error: { code: 'RECORD_VERSION_CONFLICT' },
    });
    expect(result.items[2]).toMatchObject({
      recordId: foreign.id,
      status: 'FAILED',
      error: { code: 'RECORD_NOT_FOUND' },
    });
    await expect(
      service.detail(employee, 'leads', first.id),
    ).resolves.toMatchObject({
      values: expect.objectContaining({ lead_status: 'following' }),
    });
    await expect(
      service.detail(employee, 'leads', second.id),
    ).resolves.toMatchObject({
      title: '乙线索',
    });
  });

  it('imports mapped rows and reports per-row validation failures', async () => {
    const { service } = fixture();

    const result = await service.importRows(
      employee,
      'leads',
      {
        rows: [
          {
            rowNumber: 2,
            values: { name: '导入甲', email: 'alpha@example.com' },
          },
          {
            rowNumber: 3,
            values: { name: '导入乙', email: 'not-an-email' },
          },
        ],
      },
      meta,
    );

    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items[0]).toMatchObject({
      rowNumber: 2,
      status: 'CREATED',
    });
    expect(result.items[1]).toMatchObject({
      rowNumber: 3,
      status: 'FAILED',
      error: { code: 'FIELD_INVALID', fields: ['email'] },
    });
    await expect(
      service.list(employee, 'leads', {
        page: 1,
        limit: 20,
        sort: 'updatedAt',
        direction: 'desc',
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ title: '导入甲' })],
    });
  });

  it('returns RECORD_VERSION_CONFLICT for stale updates', async () => {
    const { service } = fixture();
    const record = await create(service, employee, '张三');

    await expect(
      service.update(
        employee,
        'leads',
        record.id,
        { version: record.version + 1, values: { name: '过期写入' } },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
  });

  it('allows only admins to soft delete and never returns deleted records', async () => {
    const { service } = fixture();
    const record = await create(service, admin, '待删除', employee.memberId);

    await expect(
      service.remove(
        employee,
        'leads',
        record.id,
        { version: record.version },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    await expect(
      service.remove(
        admin,
        'leads',
        record.id,
        { version: record.version },
        meta,
      ),
    ).resolves.toEqual({ accepted: true });
    await expect(
      service.detail(admin, 'leads', record.id),
    ).rejects.toMatchObject({
      code: 'RECORD_NOT_FOUND',
    });
  });

  it('uses RECORD_NOT_FOUND without revealing missing record existence', async () => {
    const { service } = fixture();
    await expect(
      service.detail(employee, 'leads', 'record-missing'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('exports the current filter as a UTF-8 BOM CSV of visible columns', async () => {
    const { service } = fixture();
    await create(service, admin, '公开标题', employee.memberId, {
      email: 'alpha@example.com',
      secret: '机密标记',
    });
    await create(service, admin, '另一条', otherMemberId, {
      email: 'beta@example.com',
    });

    const file = await service.exportCsv(
      admin,
      'leads',
      {
        search: 'alpha@',
        sort: 'updatedAt',
        direction: 'desc',
      },
      meta,
    );

    expect(file.fileName).toBe('销售线索.csv');
    expect(file.rowCount).toBe(1);
    expect(file.csv.startsWith('\uFEFF')).toBe(true);
    expect(file.csv).toContain('业务编号,负责人,姓名,邮箱,创建时间,最近更新');
    expect(file.csv).toContain('员工');
    expect(file.csv).toContain('alpha@example.com');
    expect(file.csv).not.toContain('机密标记');
    expect(file.csv).not.toContain('beta@example.com');
  });

  it('exports only the requested visible personal columns', async () => {
    const { service } = fixture();
    await create(service, admin, '公开标题', employee.memberId, {
      email: 'alpha@example.com',
      secret: '机密标记',
    });

    const file = await service.exportCsv(
      employee,
      'leads',
      {
        sort: 'updatedAt',
        direction: 'desc',
        columns: ['email', 'secret'],
      },
      meta,
    );

    expect(file.csv).toContain('业务编号,负责人,邮箱,创建时间,最近更新');
    expect(file.csv).toContain('alpha@example.com');
    expect(file.csv).not.toContain('机密标记');
    expect(file.csv.split('\r\n')[0]).not.toContain('姓名');
  });

  it('rejects an export that exceeds the row cap', async () => {
    const { service, store } = fixture();
    for (let index = 0; index < 3; index += 1) {
      await create(service, admin, `线索${index}`, employee.memberId);
    }
    store.listRecords = async (query) => {
      const result = await MemoryRecordsStore.prototype.listRecords.call(
        store,
        query,
      );
      return { ...result, total: 5001 };
    };

    await expect(
      service.exportCsv(
        admin,
        'leads',
        { sort: 'updatedAt', direction: 'desc' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_EXPORT_LIMIT' });
  });

  it('appends a member activity to a visible record without rewriting history', async () => {
    const { service, store } = fixture();
    const record = await create(service, employee, '张三');

    const created = await service.createActivity(
      employee,
      'leads',
      record.id,
      { activityType: 'CALL', content: '  已电话确认需求  ' },
      meta,
    );

    expect(created).toMatchObject({
      activityType: 'CALL',
      content: '已电话确认需求',
      actorMemberId: employee.memberId,
    });
    const page = await service.listActivities(employee, 'leads', record.id, {
      page: 1,
      limit: 20,
    });
    expect(page.total).toBe(1);
    expect(page.items[0].content).toBe('已电话确认需求');
    expect(store.audits.map((event) => event.action)).toContain(
      'record.activity_created',
    );
  });

  it('hides activities of records the employee cannot read', async () => {
    const { service } = fixture();
    const record = await create(service, admin, '别人的线索', otherMemberId);

    await expect(
      service.listActivities(employee, 'leads', record.id, {
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    await expect(
      service.createActivity(
        employee,
        'leads',
        record.id,
        { activityType: 'NOTE', content: '不该写入' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('requires update access to append an activity', async () => {
    const { service, publishedRepository } = fixture();
    const record = await create(service, admin, '只读线索', employee.memberId);
    const configuration = publishedRepository.record
      .configuration as PublishedObjectSchema;
    configuration.employeeAccess.canUpdate = false;
    configuration.employeeAccess.updateScope = 'NONE';

    await expect(
      service.createActivity(
        employee,
        'leads',
        record.id,
        { activityType: 'NOTE', content: '备注' },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
  });
});
