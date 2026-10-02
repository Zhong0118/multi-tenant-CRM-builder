import type { Prisma } from '@crm/database';
import { AuditRepository } from './audit.repository';

it('returns the database-generated ID of the persisted audit row', async () => {
  const rows: Array<{ id: string; action: string }> = [];
  const tx = {
    auditLog: {
      create: jest.fn(async ({ data }: { data: { action: string } }) => {
        const row = { id: 'audit-persisted-1', action: data.action };
        rows.push(row);
        return row;
      }),
    },
  } as unknown as Prisma.TransactionClient;
  const id = await new AuditRepository().append(tx, {
    tenantId: 'tenant-a',
    actorType: 'USER',
    actorId: 'user-1',
    action: 'record.updated',
    resourceType: 'record',
    resourceId: 'record-1',
    requestId: 'request-1',
  });
  expect(id).toBe(rows[0]?.id);
  expect(rows).toEqual([{ id: 'audit-persisted-1', action: 'record.updated' }]);
});
