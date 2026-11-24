import type { RecordsTransaction } from '../records/records.repository';
import { ApiException } from '../../common/errors/api.exception';
import { SalesDraftsService } from './sales-drafts.service';
import { localDateAt } from '../follow-ups/follow-up-workbench-time';
const actor = {
  tenantId: 'tenant',
  memberId: 'me',
  role: 'EMPLOYEE',
  userId: 'user',
} as never;
const options = {
  kind: 'message',
  purpose: 'followup',
  length: 'short',
  tone: 'formal',
} as const;
it('denies both endpoints before expensive reads or provider access', async () => {
  const db = { withTenantTransaction: jest.fn() };
  const ledger = {
    assertFeature: jest
      .fn()
      .mockRejectedValue(new ApiException('AI_FEATURE_NOT_INCLUDED', 403)),
  };
  const provider = { resolveText: jest.fn() };
  const service = new SalesDraftsService(
    db as never,
    ledger as never,
    provider as never,
  );
  await expect(
    service.write(actor, 'table', 'id', options),
  ).rejects.toMatchObject({ code: 'AI_FEATURE_NOT_INCLUDED' });
  await expect(service.report(actor, '2026-11-24')).rejects.toMatchObject({
    code: 'AI_FEATURE_NOT_INCLUDED',
  });
  expect(db.withTenantTransaction).not.toHaveBeenCalled();
  expect(provider.resolveText).not.toHaveBeenCalled();
});
it('skips the model when no work can be attributed to this member and date', async () => {
  const model = { resolveText: jest.fn() };
  const empty = { findMany: jest.fn().mockResolvedValue([]) };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    recordActivity: empty,
    recordFollowUp: empty,
    record: empty,
    recordTransitionHistory: empty,
    auditLog: empty,
  };
  const db = {
    withTenantTransaction: <T>(
      ctx: unknown,
      cb: (db: RecordsTransaction) => Promise<T>,
    ) =>
      cb({
        tx,
        store: { getTenantTimezone: () => Promise.resolve('Asia/Shanghai') },
      } as unknown as RecordsTransaction),
  };
  const service = new SalesDraftsService(
    db as never,
    { assertFeature: jest.fn() } as never,
    model as never,
  );
  expect(
    await service.report(actor, localDateAt(new Date(), 'Asia/Shanghai')),
  ).toMatchObject({ empty: true });
  expect(model.resolveText).not.toHaveBeenCalled();
});
it('maps raw SDK failures to a fixed safe error before they can reach the exception logger', async () => {
  const db = {
    withTenantTransaction: jest.fn().mockResolvedValue({
      title: 'title',
      facts: [],
      timeZone: 'Asia/Shanghai',
    }),
  };
  const provider = {
    generateSalesDaily: jest
      .fn()
      .mockRejectedValue(new Error('UPSTREAM_PRIVATE_BODY')),
  };
  const service = new SalesDraftsService(
    db as never,
    { assertFeature: jest.fn() } as never,
    provider as never,
  );
  await expect(
    service.write(actor, 'table', 'id', options),
  ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
});
