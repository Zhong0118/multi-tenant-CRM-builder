import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AiOperationRepository } from './ai-operation.repository';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';

jest.mock('../objects/published-object-transaction', () => ({
  resolvePublishedObjectInTransaction: jest.fn(),
}));

const resolved = {
  schema: {
    object: { id: 'object-id', titleFieldKey: 'name' },
    fields: [{ fieldKey: 'name' }, { fieldKey: 'phone' }],
  },
  access: {
    canRead: true,
    readScope: 'ALL',
    fields: { name: 'READ', phone: 'HIDDEN' },
  },
};

const context: TenantContext = {
  tenantId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
  userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0c',
  tenantCode: 'demo',
  role: 'EMPLOYEE',
};
const id = '0198ad18-a74d-7b69-b81a-49a74f9a3e14';
const conversationId = '0198ad18-a74d-7b69-b81a-49a74f9a3e15';
const turnId = '0198ad18-a74d-7b69-b81a-49a74f9a3e16';
const row = {
  id,
  tenantId: context.tenantId,
  conversationId,
  turnId,
  requestedByMemberId: context.memberId,
  operationType: 'ADD_ACTIVITY_NOTE',
  status: 'PROPOSED',
  requestText: 'write note',
  proposalJson: { objectCode: 'demo', recordId: id, content: 'secret' },
  displayChangesJson: {
    title: 'Note',
    titleFieldKey: 'name',
    targetSummary: 'Record',
    changes: [],
  },
  targetRefJson: { objectCode: 'demo', recordId: id },
  expectedVersion: 1,
  expectedPublicationId: id,
  auditId: null,
  resultJson: null,
  failureCode: null,
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(),
  updatedAt: new Date(),
  confirmedAt: null,
  executedAt: null,
  confirmedByMemberId: null,
};

function setup(
  operation: Omit<typeof row, 'resultJson'> & {
    resultJson: null | { recordId: string };
  } = { ...row },
) {
  jest
    .mocked(resolvePublishedObjectInTransaction)
    .mockReset()
    .mockResolvedValue(resolved as never);
  const queryRaw = jest.fn().mockResolvedValue([{ ...operation }]);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findFirst = jest.fn().mockResolvedValue(operation);
  const tx = {
    $queryRaw: queryRaw,
    record: { findMany: jest.fn().mockResolvedValue([{ id }]) },
    recordFollowUp: {
      findMany: jest.fn().mockResolvedValue([{ id: 'task-id' }]),
    },
    aiOperation: {
      updateMany,
      findFirst,
      findMany: jest.fn().mockResolvedValue([operation]),
      create: jest.fn().mockResolvedValue(operation),
    },
  };
  const runner = { withTenant: jest.fn(async (_context, work) => work(tx)) };
  const repo = new AiOperationRepository(
    runner as unknown as DatabaseContextRunner,
  );
  return { repo, tx, runner, queryRaw, updateMany, findFirst };
}

describe('AiOperationRepository', () => {
  it('hides revoked historical UPDATE values and never exposes internal field keys', async () => {
    const { repo, tx } = setup();
    tx.aiOperation.findFirst.mockResolvedValueOnce({
      ...row,
      operationType: 'UPDATE_RECORD',
      status: 'EXECUTED',
      auditId: 'audit-id',
      displayChangesJson: {
        title: '修改记录',
        titleFieldKey: 'name',
        targetSummary: 'Record',
        validationWarnings: [],
        changes: [
          {
            fieldKey: 'phone',
            label: 'Phone',
            before: 'old-secret',
            after: 'new-secret',
          },
          {
            fieldKey: 'name',
            label: 'Name',
            before: 'Old name',
            after: 'New name',
          },
          { label: 'Legacy', before: 'legacy-secret', after: 'legacy-secret' },
        ],
      },
    } as never);
    const view = await repo.getOwned(context, id);
    expect(view).toMatchObject({
      targetSummary: 'Record',
      status: 'EXECUTED',
      auditId: 'audit-id',
      changes: [{ label: 'Name', before: 'Old name', after: 'New name' }],
    });
    expect(JSON.stringify(view)).not.toMatch(/secret|fieldKey|phone/);
  });
  it('redacts an old title when its source field becomes hidden after republishing', async () => {
    const { repo, tx } = setup();
    tx.aiOperation.findFirst.mockResolvedValueOnce({
      ...row,
      displayChangesJson: {
        title: 'Note',
        titleFieldKey: 'phone',
        targetSummary: 'secret old title',
        changes: [],
        validationWarnings: [],
      },
    } as never);
    const view = await repo.getOwned(context, id);
    expect(view?.targetSummary).toBe('');
    expect(JSON.stringify(view)).not.toContain('titleFieldKey');
  });
  it('does not replay a reassigned follow-up link when the record remains readable', async () => {
    const { repo, tx } = setup();
    tx.aiOperation.findFirst.mockResolvedValueOnce({
      ...row,
      operationType: 'CREATE_FOLLOW_UP',
      status: 'EXECUTED',
      resultJson: { objectCode: 'demo', recordId: id, followUpId: 'task-id' },
    } as never);
    tx.recordFollowUp.findMany.mockResolvedValue([]);
    const view = await repo.getOwned(context, id);
    expect(view).toMatchObject({
      status: 'EXECUTED',
      targetSummary: 'Record',
      result: null,
    });
    expect(tx.recordFollowUp.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: context.tenantId,
        id: { in: ['task-id'] },
        assigneeMemberId: context.memberId,
      },
      select: { id: true },
    });
    tx.recordFollowUp.findMany.mockResolvedValue([{ id: 'task-id' }]);
    tx.aiOperation.findFirst.mockResolvedValueOnce({
      ...row,
      operationType: 'CREATE_FOLLOW_UP',
      status: 'EXECUTED',
      resultJson: { objectCode: 'demo', recordId: id, followUpId: 'task-id' },
    } as never);
    expect(await repo.getOwned(context, id)).toMatchObject({
      result: { objectCode: 'demo', recordId: id, followUpId: 'task-id' },
    });
  });
  it('fails closed for legacy display without title source metadata', async () => {
    const { repo, tx } = setup();
    tx.aiOperation.findFirst.mockResolvedValueOnce({
      ...row,
      displayChangesJson: {
        title: 'Note',
        targetSummary: 'old untracked title',
        changes: [],
      },
    } as never);
    expect(await repo.getOwned(context, id)).toMatchObject({
      targetSummary: '',
    });
  });
  it('fails closed for legacy history missing its target reference', async () => {
    const { repo, tx } = setup();
    tx.aiOperation.findFirst.mockResolvedValueOnce({
      ...row,
      targetRefJson: null,
    } as never);
    expect(await repo.getOwned(context, id)).toMatchObject({
      targetSummary: '',
      changes: [],
    });
  });

  it.each(['object', 'title', 'record', 'unpublished'])(
    'redacts revoked %s access across GET, history and terminal/failure responses',
    async (revocation) => {
      const { repo, tx } = setup({
        ...row,
        status: 'EXECUTED',
        resultJson: { recordId: id },
        auditId: 'audit-id',
        displayChangesJson: {
          title: 'Note',
          targetSummary: 'private-title',
          changes: [{ label: 'NOTE', after: 'private-note' }],
        },
      } as never);
      if (revocation === 'object')
        jest.mocked(resolvePublishedObjectInTransaction).mockResolvedValue({
          ...resolved,
          access: { ...resolved.access, canRead: false },
        } as never);
      if (revocation === 'title')
        jest.mocked(resolvePublishedObjectInTransaction).mockResolvedValue({
          ...resolved,
          access: { ...resolved.access, fields: { name: 'HIDDEN' } },
        } as never);
      if (revocation === 'record') tx.record.findMany.mockResolvedValue([]);
      if (revocation === 'unpublished')
        jest
          .mocked(resolvePublishedObjectInTransaction)
          .mockRejectedValue(new ApiException('OBJECT_NOT_FOUND', 404));
      const get = await repo.getOwned(context, id);
      const history = (
        await repo.listForTurns(context, conversationId, [turnId])
      )[0];
      const terminal = await repo.lockOwned(tx as never, context, id);
      if (terminal.kind === 'EXECUTED') expect(terminal.result).toBeNull();
      const failure = await repo.markFailureIfProposed(
        context,
        id,
        'CONFLICTED',
        'OBJECT_ACTION_FORBIDDEN',
      );
      for (const view of [
        get,
        history,
        'view' in terminal ? terminal.view : null,
        failure,
      ]) {
        expect(view).toMatchObject({
          status: 'EXECUTED',
          auditId: 'audit-id',
          targetSummary: '',
          changes: [],
          result: null,
        });
        expect(JSON.stringify(view)).not.toContain('private');
      }
    },
  );

  it('checks OWN read visibility in one tenant/object/deletion-scoped record batch, ignoring update scope', async () => {
    const { repo, tx } = setup();
    jest.mocked(resolvePublishedObjectInTransaction).mockResolvedValue({
      ...resolved,
      access: { ...resolved.access, readScope: 'OWN', updateScope: 'ALL' },
    } as never);
    tx.record.findMany.mockResolvedValue([]);
    expect(
      await repo.listForTurns(context, conversationId, [turnId]),
    ).toMatchObject([{ targetSummary: '', changes: [] }]);
    expect(tx.record.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: context.tenantId,
        objectId: 'object-id',
        id: { in: [id] },
        deletedAt: null,
        ownerMemberId: context.memberId,
      },
      select: { id: true },
    });
    expect(tx.record.findMany).toHaveBeenCalledTimes(1);
    jest.mocked(resolvePublishedObjectInTransaction).mockResolvedValue({
      ...resolved,
      access: { ...resolved.access, readScope: 'ALL', updateScope: 'OWN' },
    } as never);
    tx.record.findMany.mockResolvedValue([{ id }]);
    expect(await repo.getOwned(context, id)).toMatchObject({
      targetSummary: 'Record',
    });
    expect(tx.record.findMany.mock.lastCall![0].where).not.toHaveProperty(
      'ownerMemberId',
    );
  });

  it('batches history record visibility once for each object', async () => {
    const { repo, tx } = setup();
    tx.aiOperation.findMany.mockResolvedValue([
      row,
      {
        ...row,
        id: 'second-operation',
        turnId: 'second-turn',
        targetRefJson: { objectCode: 'demo', recordId: 'second-record' },
      },
    ] as never);
    const views = await repo.listForTurns(context, conversationId, [
      turnId,
      'second-turn',
    ]);
    expect(views).toMatchObject([
      { targetSummary: 'Record' },
      { targetSummary: '' },
    ]);
    expect(resolvePublishedObjectInTransaction).toHaveBeenCalledTimes(1);
    expect(tx.record.findMany).toHaveBeenCalledTimes(1);
    expect(tx.record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [id, 'second-record'] } }),
      }),
    );
  });

  it('returns not found if owner membership/conversation cannot be locked', async () => {
    const { repo, tx, queryRaw, updateMany } = setup();
    queryRaw.mockResolvedValueOnce([]);
    expect(await repo.lockOwned(tx as never, context, id)).toEqual({
      kind: 'NOT_FOUND',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('locks in caller transaction and commits expiry instead of throwing after update', async () => {
    const { repo, tx, runner, updateMany } = setup({
      ...row,
      expiresAt: new Date(Date.now() - 10_000),
    });
    const outcome = await repo.lockOwned(tx as never, context, id);
    expect(outcome).toMatchObject({ kind: 'EXPIRED' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id,
          tenantId: context.tenantId,
          requestedByMemberId: context.memberId,
          status: 'PROPOSED',
        }),
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    );
    expect(runner.withTenant).not.toHaveBeenCalled();
  });

  it('never replays an executed operation, returning stored result', async () => {
    const result = { recordId: id };
    const { repo, tx, updateMany } = setup({
      ...row,
      status: 'EXECUTED',
      resultJson: result,
    });
    expect(await repo.lockOwned(tx as never, context, id)).toMatchObject({
      kind: 'EXECUTED',
      result,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('writes audit linkage and result in caller transaction only for proposed operation', async () => {
    const { repo, tx, runner, updateMany } = setup();
    await repo.markExecuted(tx as never, context, id, id, { recordId: id });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id,
          status: 'PROPOSED',
          requestedByMemberId: context.memberId,
        }),
        data: expect.objectContaining({
          status: 'EXECUTED',
          auditId: id,
          confirmedByMemberId: context.memberId,
          resultJson: { recordId: id },
        }),
      }),
    );
    expect(runner.withTenant).not.toHaveBeenCalled();
  });

  it('does not report success when execution state transition loses its race', async () => {
    const { repo, tx, updateMany } = setup();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      repo.markExecuted(tx as never, context, id, id, { recordId: id }),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_FOUND' });
  });

  it('persists domain failure separately and conditionally, never overwriting executed', async () => {
    const { repo, runner, updateMany } = setup();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await repo.markFailureIfProposed(
      context,
      id,
      'CONFLICTED',
      'RECORD_VERSION_CONFLICT',
    );
    expect(runner.withTenant).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id,
          status: 'PROPOSED',
          requestedByMemberId: context.memberId,
        }),
        data: expect.objectContaining({
          status: 'CONFLICTED',
          failureCode: 'RECORD_VERSION_CONFLICT',
        }),
      }),
    );
  });

  it('strips internal field keys from the initial preview/stream result while storing them', async () => {
    const { repo, tx, queryRaw } = setup();
    queryRaw.mockResolvedValueOnce([{ created_at: new Date() }]);
    Object.assign(tx, {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: conversationId }),
      },
      aiMessage: { findFirst: jest.fn().mockResolvedValue({ id: turnId }) },
    });
    const display = {
      title: '修改记录',
      titleFieldKey: 'name',
      targetSummary: 'Record',
      validationWarnings: [],
      changes: [
        { fieldKey: 'name', label: 'Name', before: 'Old', after: 'New' },
      ],
    };
    tx.aiOperation.create.mockResolvedValueOnce({
      ...row,
      operationType: 'UPDATE_RECORD',
      displayChangesJson: display,
    } as never);
    const view = await repo.createValidatedInTransaction(
      tx as never,
      context,
      turnId,
      {
        conversationId,
        operationType: 'UPDATE_RECORD',
        requestText: 'update',
        proposal: { values: { name: 'New' } },
        targetRef: { objectCode: 'demo', recordId: id },
        expectedVersion: 1,
        expectedPublicationId: id,
      },
      display,
    );
    expect(view.changes).toEqual([
      { label: 'Name', before: 'Old', after: 'New' },
    ]);
    expect(view.targetSummary).toBe('Record');
    expect(JSON.stringify(view)).not.toMatch(/fieldKey|titleFieldKey/);
    expect(tx.aiOperation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ displayChangesJson: display }),
      }),
    );
  });

  it('creates in the supplied transaction without opening a nested tenant runner', async () => {
    const { repo, tx, runner, queryRaw } = setup();
    queryRaw.mockResolvedValueOnce([
      { created_at: new Date('2026-09-24T12:34:56.789Z') },
    ]);
    Object.assign(tx, {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: conversationId }),
      },
      aiMessage: { findFirst: jest.fn().mockResolvedValue({ id: turnId }) },
    });
    await repo.createValidatedInTransaction(
      tx as never,
      context,
      turnId,
      {
        conversationId,
        operationType: 'ADD_ACTIVITY_NOTE',
        requestText: 'note',
        proposal: { content: 'note' },
        targetRef: { recordId: id },
        expectedVersion: 1,
        expectedPublicationId: id,
      },
      {
        title: 'Note',
        targetSummary: 'Record',
        changes: [],
        validationWarnings: [],
      },
    );
    expect(runner.withTenant).not.toHaveBeenCalled();
    expect(tx.aiOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdAt: new Date('2026-09-24T12:34:56.789Z'),
        expiresAt: new Date('2026-09-24T12:49:56.789Z'),
      }),
    });
  });

  it('uses one database instant for creation and exact 15-minute expiry', async () => {
    const { repo, tx, queryRaw } = setup();
    const createdAt = new Date('2026-09-24T12:34:56.789Z');
    queryRaw.mockResolvedValueOnce([{ created_at: createdAt }]);
    Object.assign(tx, {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: conversationId }),
      },
      aiMessage: { findFirst: jest.fn().mockResolvedValue({ id: turnId }) },
    });
    await repo.createValidated(
      context,
      turnId,
      {
        conversationId,
        operationType: 'ADD_ACTIVITY_NOTE',
        requestText: 'note',
        proposal: { content: 'note' },
        targetRef: { recordId: id },
        expectedVersion: 1,
        expectedPublicationId: id,
      },
      {
        title: 'Note',
        targetSummary: 'Record',
        changes: [],
        validationWarnings: [],
      },
    );
    expect(tx.aiOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdAt,
        expiresAt: new Date('2026-09-24T12:49:56.789Z'),
      }),
    });
  });

  it('does not create a proposal for a turn outside its owning conversation', async () => {
    const { repo, tx } = setup();
    Object.assign(tx, {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: conversationId }),
      },
      aiMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      repo.createValidated(
        context,
        turnId,
        {
          conversationId,
          operationType: 'ADD_ACTIVITY_NOTE',
          requestText: 'note',
          proposal: { content: 'note' },
          targetRef: { recordId: id },
          expectedVersion: 1,
          expectedPublicationId: id,
        },
        {
          title: 'Note',
          targetSummary: 'Record',
          changes: [],
          validationWarnings: [],
        },
      ),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_FOUND' });
    expect(tx.aiOperation.create).not.toHaveBeenCalled();
  });

  it('projects a safe display without returning raw candidate or request text', async () => {
    const { repo } = setup();
    const view = await repo.getOwned(context, id);
    expect(view).toMatchObject({
      proposalId: id,
      status: 'PROPOSED',
      operation: 'ADD_ACTIVITY_NOTE',
    });
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('requestText');
    expect(
      (await repo.listForTurns(context, conversationId, [turnId]))[0],
    ).toEqual(view);
  });
});
