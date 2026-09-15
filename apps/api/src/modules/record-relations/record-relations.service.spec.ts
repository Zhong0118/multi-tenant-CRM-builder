import { RecordRelationsService } from './record-relations.service';
import type { TenantContext } from '../../common/tenancy/tenant-context';
const context: TenantContext = {
  tenantId: 'tenant',
  tenantCode: 'demo',
  userId: 'user',
  memberId: 'me',
  role: 'EMPLOYEE',
};
function fixture() {
  const tx = {
    record: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'target', title: 'Visible' }),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { id: 'link', targetId: 'target', objectCode: 'contacts' },
      ]),
    $executeRaw: jest.fn(),
  };
  const runner = {
    withTenant: jest.fn(
      (_ctx: TenantContext, fn: (value: typeof tx) => Promise<unknown>) =>
        fn(tx),
    ),
  };
  const objects = {
    resolveRuntimeSchema: jest.fn().mockResolvedValue({
      schema: { object: { id: 'object' } },
      access: { canUpdate: true, readScope: 'ALL', updateScope: 'ALL' },
    }),
  };
  const audit = { append: jest.fn() };
  return {
    tx,
    objects,
    audit,
    runner,
    service: new RecordRelationsService(
      runner as never,
      objects as never,
      audit as never,
    ),
  };
}
describe('record relation permissions', () => {
  it('does not list relations if source is outside visible record scope', async () => {
    const { tx, service } = fixture();
    tx.record.findFirst.mockResolvedValue(null);
    await expect(
      service.list(context, 'leads', 'source'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('requires source update permission before inserting', async () => {
    const { tx, objects, service } = fixture();
    objects.resolveRuntimeSchema.mockResolvedValue({
      schema: { object: { id: 'object' } },
      access: { canUpdate: false, readScope: 'ALL', updateScope: 'NONE' },
    });
    await expect(
      service.add(
        context,
        'leads',
        'source',
        { objectCode: 'contacts', recordId: 'target' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'OBJECT_ACTION_FORBIDDEN' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('checks target OWN scope during the same locked mutation transaction', async () => {
    const { tx, objects, service } = fixture();
    objects.resolveRuntimeSchema.mockResolvedValue({
      schema: { object: { id: 'object' } },
      access: { canUpdate: true, readScope: 'OWN', updateScope: 'OWN' },
    });
    tx.$queryRaw
      .mockResolvedValueOnce([{ role: 'EMPLOYEE' }])
      .mockResolvedValueOnce([{ id: 'source' }] as never)
      .mockResolvedValueOnce([]);
    await expect(
      service.add(
        context,
        'leads',
        'source',
        { objectCode: 'contacts', recordId: 'target' },
        { requestId: 'req' },
      ),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });
});

it('normalizes UUID case before preventing self-links and ordering pairs', async () => {
  const { service, tx } = fixture();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await expect(
    service.add(
      context,
      'leads',
      id.toUpperCase(),
      { objectCode: 'leads', recordId: id },
      { requestId: 'req' },
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  await expect(
    service.scope(context, 'leads', id.toUpperCase(), false),
  ).resolves.toMatchObject({ id });
});

describe('relation actor mutation lock', () => {
  it.each([{ actors: [] }, { actors: [{ role: 'TENANT_ADMIN' }] }])(
    'rejects missing/inactive actor or changed role before record mutation: %j',
    async ({ actors }) => {
      const { service, tx } = fixture();
      tx.$queryRaw.mockResolvedValueOnce(actors);
      await expect(
        service.add(
          context,
          'leads',
          'source',
          { objectCode: 'contacts', recordId: 'target' },
          { requestId: 'req' },
        ),
      ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.record.findFirst).not.toHaveBeenCalled();
    },
  );
  it('rechecks actor under lock before removing a visible relation', async () => {
    const { service, tx } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { id: 'link', targetId: 'target', objectCode: 'contacts' },
      ])
      .mockResolvedValueOnce([]);
    await expect(
      service.remove(context, 'leads', 'source', 'link', { requestId: 'req' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('removes a visible relation under the same locks and audits it', async () => {
    const { service, tx, audit } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { id: 'link', targetId: 'target', objectCode: 'contacts' },
      ])
      .mockResolvedValueOnce([{ role: 'EMPLOYEE' }])
      .mockResolvedValueOnce([{ id: 'source' }])
      .mockResolvedValueOnce([{ id: 'target' }]);
    tx.$executeRaw.mockResolvedValue(1);

    await expect(
      service.remove(context, 'leads', 'source', 'link', { requestId: 'req' }),
    ).resolves.toEqual({ success: true });

    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'record.relation_removed',
        resourceId: 'source',
        before: { targetRecordId: 'target' },
        requestId: 'req',
      }),
    );
  });

  it('fails a remove that deleted no row', async () => {
    const { service, tx, audit } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { id: 'link', targetId: 'target', objectCode: 'contacts' },
      ])
      .mockResolvedValueOnce([{ role: 'EMPLOYEE' }])
      .mockResolvedValueOnce([{ id: 'source' }])
      .mockResolvedValueOnce([{ id: 'target' }]);
    tx.$executeRaw.mockResolvedValue(0);

    await expect(
      service.remove(context, 'leads', 'source', 'link', { requestId: 'req' }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe('relation service transaction boundary', () => {
  it('runs the shared command inside one tenant transaction and audits on its client', async () => {
    const { service, tx, objects, audit, runner } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([{ role: 'EMPLOYEE' }])
      .mockResolvedValueOnce([{ id: 'source' }])
      .mockResolvedValueOnce([{ id: 'target' }]);

    await expect(
      service.add(
        context,
        'leads',
        'source',
        { objectCode: 'contacts', recordId: 'target' },
        { requestId: 'req' },
      ),
    ).resolves.toEqual({ success: true });

    expect(runner.withTenant).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'record.relation_added',
        resourceId: 'source',
        after: { targetRecordId: 'target' },
      }),
    );
    // Pins order only, NOT atomicity: `add()` now opens its write transaction
    // before the command resolves scopes, and each `resolveRuntimeSchema` call
    // still opens its OWN transaction (see the `resolveScope` contract in
    // record-relation-command.ts). Consequence: a 400/403 now aborts an already
    // opened transaction. This assertion makes that order deliberate rather
    // than claiming the resolver runs inside `tx`.
    expect(runner.withTenant.mock.invocationCallOrder[0]).toBeLessThan(
      objects.resolveRuntimeSchema.mock.invocationCallOrder[0],
    );
  });

  it('returns a duplicate relation as a no-op without a second transaction', async () => {
    const { service, tx, audit, runner } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([{ role: 'EMPLOYEE' }])
      .mockResolvedValueOnce([{ id: 'source' }])
      .mockResolvedValueOnce([{ id: 'target' }])
      .mockResolvedValueOnce([]);

    await expect(
      service.add(
        context,
        'leads',
        'source',
        { objectCode: 'contacts', recordId: 'target' },
        { requestId: 'req' },
      ),
    ).resolves.toEqual({ success: true });

    expect(runner.withTenant).toHaveBeenCalledTimes(1);
    expect(audit.append).not.toHaveBeenCalled();
  });
});
