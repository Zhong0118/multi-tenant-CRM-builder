import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AiOperationRepository } from './ai-operation.repository';

const context: TenantContext = {
  tenantId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  memberId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0e',
  userId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0c',
  tenantCode: 'demo', role: 'EMPLOYEE',
};
const id = '0198ad18-a74d-7b69-b81a-49a74f9a3e14';
const conversationId = '0198ad18-a74d-7b69-b81a-49a74f9a3e15';
const turnId = '0198ad18-a74d-7b69-b81a-49a74f9a3e16';
const row = {
  id, tenantId: context.tenantId, conversationId, turnId,
  requestedByMemberId: context.memberId, operationType: 'ADD_ACTIVITY_NOTE',
  status: 'PROPOSED', requestText: 'write note',
  proposalJson: { objectCode: 'demo', recordId: id, content: 'secret' },
  displayChangesJson: { title: 'Note', targetSummary: 'Record', changes: [] },
  targetRefJson: { objectCode: 'demo', recordId: id }, expectedVersion: 1,
  expectedPublicationId: id, auditId: null, resultJson: null, failureCode: null,
  expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
  confirmedAt: null, executedAt: null, confirmedByMemberId: null,
};

function setup(operation: Omit<typeof row, 'resultJson'> & { resultJson: null | { recordId: string } } = { ...row }) {
  const queryRaw = jest.fn().mockResolvedValue([{ ...operation }]);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findFirst = jest.fn().mockResolvedValue(operation);
  const tx = { $queryRaw: queryRaw, aiOperation: { updateMany, findFirst, findMany: jest.fn().mockResolvedValue([operation]), create: jest.fn().mockResolvedValue(operation) } };
  const runner = { withTenant: jest.fn(async (_context, work) => work(tx)) };
  const repo = new AiOperationRepository(runner as unknown as DatabaseContextRunner);
  return { repo, tx, runner, queryRaw, updateMany, findFirst };
}

describe('AiOperationRepository', () => {
  it('returns not found if owner membership/conversation cannot be locked', async () => {
    const { repo, tx, queryRaw, updateMany } = setup();
    queryRaw.mockResolvedValueOnce([]);
    expect(await repo.lockOwned(tx as never, context, id)).toEqual({ kind: 'NOT_FOUND' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('locks in caller transaction and commits expiry instead of throwing after update', async () => {
    const { repo, tx, runner, updateMany } = setup({ ...row, expiresAt: new Date(Date.now() - 10_000) });
    const outcome = await repo.lockOwned(tx as never, context, id);
    expect(outcome).toMatchObject({ kind: 'EXPIRED' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id, tenantId: context.tenantId, requestedByMemberId: context.memberId, status: 'PROPOSED' }),
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
    expect(runner.withTenant).not.toHaveBeenCalled();
  });

  it('never replays an executed operation, returning stored result', async () => {
    const result = { recordId: id };
    const { repo, tx, updateMany } = setup({ ...row, status: 'EXECUTED', resultJson: result });
    expect(await repo.lockOwned(tx as never, context, id)).toMatchObject({ kind: 'EXECUTED', result });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('writes audit linkage and result in caller transaction only for proposed operation', async () => {
    const { repo, tx, runner, updateMany } = setup();
    await repo.markExecuted(tx as never, context, id, id, { recordId: id });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id, status: 'PROPOSED', requestedByMemberId: context.memberId }),
      data: expect.objectContaining({ status: 'EXECUTED', auditId: id, confirmedByMemberId: context.memberId, resultJson: { recordId: id } }),
    }));
    expect(runner.withTenant).not.toHaveBeenCalled();
  });

  it('does not report success when execution state transition loses its race', async () => {
    const { repo, tx, updateMany } = setup();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.markExecuted(tx as never, context, id, id, { recordId: id }))
      .rejects.toMatchObject({ code: 'AI_TURN_NOT_FOUND' });
  });

  it('persists domain failure separately and conditionally, never overwriting executed', async () => {
    const { repo, runner, updateMany } = setup();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await repo.markFailureIfProposed(context, id, 'CONFLICTED', 'RECORD_VERSION_CONFLICT');
    expect(runner.withTenant).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id, status: 'PROPOSED', requestedByMemberId: context.memberId }),
      data: expect.objectContaining({ status: 'CONFLICTED', failureCode: 'RECORD_VERSION_CONFLICT' }),
    }));
  });

  it('does not create a proposal for a turn outside its owning conversation', async () => {
    const { repo, tx } = setup();
    Object.assign(tx, {
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: conversationId }) },
      aiMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(repo.createValidated(context, turnId, {
      conversationId, operationType: 'ADD_ACTIVITY_NOTE', requestText: 'note',
      proposal: { content: 'note' }, targetRef: { recordId: id },
      expectedVersion: 1, expectedPublicationId: id,
    }, { title: 'Note', targetSummary: 'Record', changes: [], validationWarnings: [] }, new Date(Date.now() + 60_000)))
      .rejects.toMatchObject({ code: 'AI_TURN_NOT_FOUND' });
    expect(tx.aiOperation.create).not.toHaveBeenCalled();
  });

  it('projects a safe display without returning raw candidate or request text', async () => {
    const { repo } = setup();
    const view = await repo.getOwned(context, id);
    expect(view).toMatchObject({ proposalId: id, status: 'PROPOSED', operation: 'ADD_ACTIVITY_NOTE' });
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('requestText');
    expect((await repo.listForTurns(context, conversationId, [turnId]))[0]).toEqual(view);
  });
});
