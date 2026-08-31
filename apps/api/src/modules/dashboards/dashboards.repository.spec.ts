import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { PrismaDashboardRepository } from './dashboards.repository';

jest.mock('@crm/database', () => ({ Prisma: {} }));

const context: TenantContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantCode: 'acme',
  memberId: 'member-1',
  role: 'TENANT_ADMIN',
};

describe('PrismaDashboardRepository persistence boundaries', () => {
  it('takes a tenant-scoped advisory lock before checking an optional definition', async () => {
    const queries: string[] = [];
    const transaction = {
      $queryRaw: jest.fn(
        async (strings: TemplateStringsArray, ..._values: unknown[]) => {
          const query = strings.join('?');
          queries.push(query);
          return [];
        },
      ),
      tenantDashboardConfiguration: {
        create: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          draftVersion: 1,
          draftConfiguration: {
            schemaVersion: 2,
            title: '工作台',
            widgets: [],
          },
          activePublicationId: null,
          sourceTemplateVersionId: null,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      },
    };
    const repository = fixture(transaction);

    await expect(
      repository.saveDraft(context, 0, {
        schemaVersion: 2,
        title: '工作台',
        widgets: [],
      }),
    ).resolves.toEqual(expect.objectContaining({ draftVersion: 1 }));

    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatch(
      /pg_advisory_xact_lock\([\s\S]*hashtext\('tenant_dashboard_configurations'\)[\s\S]*hashtext\(\?::text\)[\s\S]*\)/,
    );
    expect(queries[1]).toMatch(
      /FROM tenant_dashboard_configurations[\s\S]*FOR UPDATE/,
    );
  });

  it('returns legacy publication JSON behind a truthful discriminator', async () => {
    const legacy = {
      opportunity: {
        objectCode: 'opportunities',
        stageFieldKey: 'stage',
        amountFieldKey: 'amount',
        dateFieldKey: 'close_at',
        activeOptionKeys: ['new'],
        wonOptionKeys: ['won'],
        lostOptionKeys: ['lost'],
      },
      lead: {},
      activity: {},
    };
    const transaction = {
      tenantDashboardConfiguration: {
        findUnique: jest.fn().mockResolvedValue({
          activePublication: {
            id: 'publication-1',
            tenantId: 'tenant-1',
            publicationNo: 1,
            sourceDraftVersion: 3,
            configuration: legacy,
            publishedByMemberId: null,
            publishedAt: new Date('2026-09-01T00:00:00.000Z'),
          },
        }),
      },
    };
    const repository = fixture(transaction);

    await expect(repository.getActivePublication(context)).resolves.toEqual(
      expect.objectContaining({
        configuration: { kind: 'LEGACY', raw: legacy },
      }),
    );
  });
});

function fixture(transaction: object) {
  const runner = {
    withTenant: async <T>(
      _context: TenantContext,
      work: (value: never) => Promise<T>,
    ) => work(transaction as never),
  } as unknown as DatabaseContextRunner;
  return new PrismaDashboardRepository(runner);
}
