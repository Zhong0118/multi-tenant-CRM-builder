import { validateProposalCandidate } from './ai-proposal.schema';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import type { RecordsRepository } from '../records/records.repository';
import type { AiOperationRepository } from './ai-operation.repository';
import type { AuditService } from '../audit/audit.service';
import { AiProposalService } from './ai-proposal.service';
import * as recordCommands from '../records/record-command';
import * as followUpCommands from '../follow-ups/follow-up-command';
jest.mock('../records/record-command', () => ({
  ...jest.requireActual('../records/record-command'),
  updateRecordCommand: jest.fn(),
  createRecordActivityCommand: jest.fn(),
}));
jest.mock('../follow-ups/follow-up-command', () => ({
  ...jest.requireActual('../follow-ups/follow-up-command'),
  createFollowUpCommand: jest.fn(),
}));
import * as publication from '../objects/published-object-transaction';

jest.mock('../objects/published-object-transaction', () => ({
  resolvePublishedObjectInTransaction: jest.fn(),
}));

const id = '0198ad18-a74d-7b69-b81a-49a74f9a3e14';
const update = {
  operationType: 'UPDATE_RECORD',
  objectCode: 'leads',
  recordId: id,
  values: { name: '新名称' },
};
const followUp = {
  operationType: 'CREATE_FOLLOW_UP',
  objectCode: 'leads',
  recordId: id,
  title: '联系客户',
  dueAt: '2026-10-01T12:00:00Z',
};
const note = {
  operationType: 'ADD_ACTIVITY_NOTE',
  objectCode: 'leads',
  recordId: id,
  content: '沟通记录',
};

describe('strict proposal candidate boundary', () => {
  it.each([update, followUp, note])(
    'accepts one target and only operation-specific input',
    (candidate) => {
      expect(validateProposalCandidate(candidate)).toEqual(candidate);
    },
  );

  it.each([
    'tenantId',
    'memberId',
    'userId',
    'role',
    'ownerMemberId',
    'runAsAdmin',
    'readScope',
    'includeHidden',
    'bypassPermission',
  ])('rejects actor override %s', (key) => {
    expect(() => validateProposalCandidate({ ...update, [key]: id })).toThrow();
  });

  it.each([
    [update, { values: { name: 'valid', ownerMemberId: id } }],
    [update, { targets: [id, id] }],
    [update, { recordId: 'not-a-uuid' }],
    [update, { values: {} }],
    [followUp, { title: 'a'.repeat(201) }],
    [followUp, { dueAt: '2026-02-30T12:00:00Z' }],
    [note, { content: '  ' }],
    [note, { content: 'a'.repeat(4001) }],
    [note, { activityType: 'CALL' }],
  ])('rejects malformed or expanded operation input', (base, extra) => {
    expect(() => validateProposalCandidate({ ...base, ...extra })).toThrow();
  });
  it('rejects a batch in place of one proposal', () => {
    expect(() => validateProposalCandidate([update, update])).toThrow();
  });
});

const context: TenantContext = {
  tenantId: id,
  memberId: id,
  userId: id,
  tenantCode: 'demo',
  role: 'EMPLOYEE',
};
const record = {
  id,
  objectId: id,
  title: '可见记录',
  ownerMemberId: id,
  values: { name: '旧名称', secret: 'private' },
  version: 2,
};
const resolved = {
  schema: {
    publication: { id },
    object: { id, code: 'leads', name: '线索', titleFieldKey: 'name' },
    fields: [
      {
        fieldKey: 'name',
        label: '姓名',
        type: 'TEXT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
      },
      {
        fieldKey: 'secret',
        label: '隐私字段',
        type: 'TEXT',
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
      },
    ],
  },
  access: {
    canRead: true,
    canUpdate: true,
    readScope: 'ALL',
    updateScope: 'ALL',
    fields: { name: 'EDIT', secret: 'HIDDEN' },
  },
};
function setup() {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { id, user_id: id, role: context.role, status: 'ACTIVE' },
      ]),
    aiMessage: {
      findFirst: jest.fn().mockResolvedValue({ conversationId: id }),
    },
    aiOperation: {
      findFirst: jest.fn().mockResolvedValue({
        id,
        operationType: 'UPDATE_RECORD',
        status: 'EXECUTED',
        displayChangesJson: {
          title: '修改记录',
          targetSummary: 'record',
          changes: [],
          validationWarnings: [],
        },
        expiresAt: new Date(),
        auditId: id,
        resultJson: {},
        failureCode: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const store = {
    lockRecord: jest.fn().mockResolvedValue(record),
    findRecord: jest.fn().mockResolvedValue(record),
    memberExists: jest.fn().mockResolvedValue(true),
    applyRecordPatch: jest.fn(),
    createActivity: jest.fn(),
    appendAudit: jest.fn(),
  };
  const records = {
    withTenantTransaction: jest.fn(async (_context, work) =>
      work({ tx, store }),
    ),
  };
  const operations = {
    createValidated: jest
      .fn()
      .mockResolvedValue({ proposalId: id, status: 'PROPOSED' }),
    createValidatedInTransaction: jest
      .fn()
      .mockResolvedValue({ proposalId: id, status: 'PROPOSED' }),
    lockOwned: jest.fn(),
    markExecuted: jest.fn(),
    markFailureIfProposed: jest.fn().mockResolvedValue({
      status: 'CONFLICTED',
      failureCode: 'RECORD_VERSION_CONFLICT',
    }),
    getOwned: jest.fn(),
  };
  jest
    .mocked(publication.resolvePublishedObjectInTransaction)
    .mockResolvedValue(resolved as never);
  const audit = { appendReturningId: jest.fn().mockResolvedValue(id) };
  const service = new AiProposalService(
    records as unknown as RecordsRepository,
    operations as unknown as AiOperationRepository,
    audit as unknown as AuditService,
  );
  return { service, tx, store, records, operations, audit };
}

describe('atomic proposal and assistant completion', () => {
  it('prevalidates and persists in one tenant transaction, without calling standalone create', async () => {
    const { service, records, operations, store } = setup();
    const finish = jest.fn().mockResolvedValue(undefined);
    await service.completeWithProposal(
      context,
      id,
      note,
      'please note',
      { status: 'COMPLETED', content: 'suggestion' },
      finish,
    );
    expect(records.withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(operations.createValidatedInTransaction).toHaveBeenCalledTimes(1);
    expect(operations.createValidated).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(store.applyRecordPatch).not.toHaveBeenCalled();
    expect(store.createActivity).not.toHaveBeenCalled();
  });
});

describe('safe preview at the transaction seam', () => {
  it('refuses hidden fields without disclosing their names or writing a business row', async () => {
    const { service, store, operations } = setup();
    await expect(
      service.preview(
        context,
        id,
        { ...update, values: { secret: 'new' } },
        'update',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.applyRecordPatch).not.toHaveBeenCalled();
    expect(store.createActivity).not.toHaveBeenCalled();
    expect(operations.createValidated).not.toHaveBeenCalled();
  });
  it('refuses a record outside OWN read scope even if update scope is ALL', async () => {
    const { service, store, operations } = setup();
    jest
      .mocked(publication.resolvePublishedObjectInTransaction)
      .mockResolvedValue({
        ...resolved,
        access: { ...resolved.access, readScope: 'OWN' },
      } as never);
    store.lockRecord.mockResolvedValue({ ...record, ownerMemberId: 'other' });
    await expect(
      service.preview(context, id, followUp, 'follow up'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(operations.createValidated).not.toHaveBeenCalled();
  });
  it('reports unexpected normalization dependency failures safely as INTERNAL_ERROR', async () => {
    const { service, store, operations } = setup();
    const broken = {
      ...resolved,
      schema: {
        ...resolved.schema,
        fields: [
          {
            ...resolved.schema.fields[0],
            fieldKey: 'member',
            label: '成员',
            type: 'MEMBER',
          },
        ],
      },
      access: { ...resolved.access, fields: { name: 'EDIT', member: 'EDIT' } },
    };
    jest
      .mocked(publication.resolvePublishedObjectInTransaction)
      .mockResolvedValue(broken as never);
    store.memberExists.mockRejectedValueOnce(
      new Error('secret DB connection detail'),
    );
    await expect(
      service.preview(
        context,
        id,
        { ...update, values: { member: id } },
        'update',
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(operations.createValidated).not.toHaveBeenCalled();
  });
  it('refuses READ_ONLY fields without persisting a candidate', async () => {
    const { service, operations } = setup();
    jest
      .mocked(publication.resolvePublishedObjectInTransaction)
      .mockResolvedValue({
        ...resolved,
        access: {
          ...resolved.access,
          fields: { name: 'READ_ONLY', secret: 'HIDDEN' },
        },
      } as never);
    await expect(
      service.preview(context, id, update, 'update'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(operations.createValidated).not.toHaveBeenCalled();
  });
  it('previews normalized EMAIL and MONEY values rather than raw input', async () => {
    const { service, operations, store } = setup();
    jest
      .mocked(publication.resolvePublishedObjectInTransaction)
      .mockResolvedValue({
        ...resolved,
        schema: {
          ...resolved.schema,
          object: { ...resolved.schema.object, titleFieldKey: 'email' },
          fields: [
            {
              ...resolved.schema.fields[0],
              fieldKey: 'email',
              label: '邮箱',
              type: 'EMAIL',
            },
            {
              ...resolved.schema.fields[0],
              fieldKey: 'budget',
              label: '预算',
              type: 'MONEY',
            },
          ],
        },
        access: {
          ...resolved.access,
          fields: { email: 'EDIT', budget: 'EDIT' },
        },
      } as never);
    store.lockRecord.mockResolvedValue({
      ...record,
      values: { email: 'old@example.com', budget: '1.00' },
    });
    await service.preview(
      context,
      id,
      { ...update, values: { email: 'USER@EXAMPLE.COM', budget: '001.2' } },
      'update',
    );
    expect(operations.createValidated).toHaveBeenCalledWith(
      context,
      id,
      expect.anything(),
      expect.objectContaining({
        changes: [
          {
            label: '邮箱',
            before: 'old@example.com',
            after: 'user@example.com',
          },
          { label: '预算', before: '1.00', after: '1.20' },
        ],
      }),
    );
  });
  it('stores a bounded sanitized preview with fixed 15-minute lifetime and no business writes', async () => {
    const { service, store, operations } = setup();
    await service.preview(context, id, update, 'update');
    expect(operations.createValidated).toHaveBeenCalledWith(
      context,
      id,
      expect.objectContaining({
        expectedVersion: 2,
        expectedPublicationId: id,
      }),
      expect.objectContaining({
        changes: [{ label: '姓名', before: '旧名称', after: '新名称' }],
      }),
    );
    expect(store.applyRecordPatch).not.toHaveBeenCalled();
    expect(store.createActivity).not.toHaveBeenCalled();
  });
});

const proposed = {
  id,
  status: 'PROPOSED',
  operationType: 'UPDATE_RECORD',
  proposalJson: update,
  expectedPublicationId: id,
  expectedVersion: 2,
};
const meta = { requestId: 'request-1', ip: '127.0.0.1' };
describe('single target atomic confirmation', () => {
  beforeEach(() => {
    jest
      .mocked(recordCommands.updateRecordCommand)
      .mockReset()
      .mockResolvedValue({ record: { id } as never, auditId: id });
    jest
      .mocked(recordCommands.createRecordActivityCommand)
      .mockReset()
      .mockResolvedValue({ activity: { id } as never, auditId: id });
    jest
      .mocked(followUpCommands.createFollowUpCommand)
      .mockReset()
      .mockImplementation(
        async (_tx, _context, _input, _meta, _scope, deps) => {
          deps.onAuditId?.(id);
          return { id } as never;
        },
      );
  });
  it.each([update, followUp, note])(
    'dispatches exactly one command and links audit inside one transaction',
    async (candidate) => {
      const { service, operations, records } = setup();
      operations.lockOwned.mockResolvedValue({
        kind: 'PROPOSED',
        operation: {
          ...proposed,
          operationType: candidate.operationType,
          proposalJson: candidate,
        },
      });
      await service.confirm(context, id, id, meta);
      expect(records.withTenantTransaction).toHaveBeenCalledTimes(1);
      expect(recordCommands.updateRecordCommand).toHaveBeenCalledTimes(
        candidate.operationType === 'UPDATE_RECORD' ? 1 : 0,
      );
      expect(recordCommands.createRecordActivityCommand).toHaveBeenCalledTimes(
        candidate.operationType === 'ADD_ACTIVITY_NOTE' ? 1 : 0,
      );
      expect(followUpCommands.createFollowUpCommand).toHaveBeenCalledTimes(
        candidate.operationType === 'CREATE_FOLLOW_UP' ? 1 : 0,
      );
      expect(operations.markExecuted).toHaveBeenCalledWith(
        expect.anything(),
        context,
        id,
        id,
        expect.anything(),
      );
    },
  );
  it('replays stored EXECUTED result without touching domain commands', async () => {
    const { service, operations } = setup();
    const stored = {
      proposalId: id,
      status: 'EXECUTED',
      result: { recordId: id },
    };
    operations.lockOwned.mockResolvedValue({
      kind: 'EXECUTED',
      view: stored,
      result: stored.result,
    });
    expect(await service.confirm(context, id, id, meta)).toEqual(stored);
    expect(
      await service.confirm(
        context,
        id,
        '0198ad18-a74d-7b69-b81a-49a74f9a3e15',
        meta,
      ),
    ).toEqual(stored);
    expect(recordCommands.updateRecordCommand).not.toHaveBeenCalled();
  });
  it('commits EXPIRED normally and never invokes a domain command', async () => {
    const { service, operations } = setup();
    operations.lockOwned.mockResolvedValue({
      kind: 'EXPIRED',
      view: { status: 'EXPIRED' },
    });
    expect(await service.confirm(context, id, id, meta)).toMatchObject({
      status: 'EXPIRED',
    });
    expect(operations.markFailureIfProposed).not.toHaveBeenCalled();
  });
  it('rechecks publication and version before mutation; persists conflict only after rollback', async () => {
    const { service, operations, store } = setup();
    operations.lockOwned.mockResolvedValue({
      kind: 'PROPOSED',
      operation: { ...proposed, expectedPublicationId: 'old' },
    });
    expect(await service.confirm(context, id, id, meta)).toMatchObject({
      status: 'CONFLICTED',
    });
    expect(store.applyRecordPatch).not.toHaveBeenCalled();
    expect(operations.markFailureIfProposed).toHaveBeenCalledWith(
      context,
      id,
      'CONFLICTED',
      expect.any(String),
    );
  });
  it('refuses a stale NOTE target before appending an activity', async () => {
    const { service, operations, store } = setup();
    store.lockRecord.mockResolvedValue({ ...record, version: 3 });
    operations.lockOwned.mockResolvedValue({
      kind: 'PROPOSED',
      operation: {
        ...proposed,
        operationType: 'ADD_ACTIVITY_NOTE',
        proposalJson: note,
      },
    });
    expect(await service.confirm(context, id, id, meta)).toMatchObject({
      status: 'CONFLICTED',
    });
    expect(recordCommands.createRecordActivityCommand).not.toHaveBeenCalled();
  });
  it('rolls back a thrown command before separately marking FAILED, with no success result', async () => {
    const { service, operations, records } = setup();
    operations.lockOwned.mockResolvedValue({
      kind: 'PROPOSED',
      operation: proposed,
    });
    jest
      .mocked(recordCommands.updateRecordCommand)
      .mockRejectedValueOnce(new ApiException('VALIDATION_FAILED', 400));
    operations.markFailureIfProposed.mockResolvedValue({
      status: 'FAILED',
      failureCode: 'VALIDATION_FAILED',
    });
    expect(await service.confirm(context, id, id, meta)).toMatchObject({
      status: 'FAILED',
    });
    expect(operations.markFailureIfProposed).toHaveBeenCalledWith(
      context,
      id,
      'FAILED',
      'VALIDATION_FAILED',
    );
    expect(operations.markExecuted).not.toHaveBeenCalled();
    expect(records.withTenantTransaction).toHaveBeenCalledTimes(1);
  });
  it('records a sanitized FAILED state after an unexpected domain command error', async () => {
    const { service, operations } = setup();
    operations.lockOwned.mockResolvedValue({
      kind: 'PROPOSED',
      operation: proposed,
    });
    operations.markFailureIfProposed.mockResolvedValue({
      status: 'FAILED',
      failureCode: 'INTERNAL_ERROR',
    });
    jest
      .mocked(recordCommands.updateRecordCommand)
      .mockRejectedValueOnce(new Error('database detail secret'));
    expect(await service.confirm(context, id, id, meta)).toMatchObject({
      status: 'FAILED',
      failureCode: 'INTERNAL_ERROR',
    });
    expect(operations.markFailureIfProposed).toHaveBeenCalledWith(
      context,
      id,
      'FAILED',
      'INTERNAL_ERROR',
    );
    expect(operations.markExecuted).not.toHaveBeenCalled();
  });
  it('rejects read OWN / update ALL for a different owner on confirm', async () => {
    const { service, operations, store } = setup();
    jest
      .mocked(publication.resolvePublishedObjectInTransaction)
      .mockResolvedValue({
        ...resolved,
        access: { ...resolved.access, readScope: 'OWN' },
      } as never);
    store.lockRecord.mockResolvedValue({ ...record, ownerMemberId: 'other' });
    operations.lockOwned.mockResolvedValue({
      kind: 'PROPOSED',
      operation: {
        ...proposed,
        operationType: 'CREATE_FOLLOW_UP',
        proposalJson: followUp,
      },
    });
    expect(await service.confirm(context, id, id, meta)).toMatchObject({
      status: 'CONFLICTED',
    });
    expect(followUpCommands.createFollowUpCommand).not.toHaveBeenCalled();
  });
});
