import type { ConfigService } from '@nestjs/config';

import { PlatformOperationsService } from './platform-operations.service';

describe('PlatformOperationsService', () => {
  it('returns paged audit and operation data from the platform repository', async () => {
    const repository = {
      listAudit: jest.fn().mockResolvedValue({
        items: [{ id: 'audit-1', action: 'TENANT_CREATED' }],
        page: 2,
        limit: 20,
        total: 31,
      }),
      listOperations: jest.fn().mockResolvedValue({
        items: [{ id: 'application-1', status: 'SUCCEEDED' }],
        page: 1,
        limit: 20,
        total: 1,
      }),
    };
    const service = new PlatformOperationsService(
      repository,
      config({ NODE_ENV: 'test' }),
      {
        check: () => Promise.resolve({ database: true, redis: true }),
      } as never,
    );

    await expect(
      service.listAudit('platform-user', {
        page: 2,
        limit: 20,
        action: 'TENANT_CREATED',
      }),
    ).resolves.toMatchObject({ page: 2, total: 31 });
    await expect(
      service.listOperations('platform-user', { page: 1, limit: 20 }),
    ).resolves.toMatchObject({ total: 1 });
    expect(repository.listAudit).toHaveBeenCalledWith(
      'platform-user',
      expect.objectContaining({ action: 'TENANT_CREATED' }),
    );
  });

  it('reports readiness without returning connection strings or secrets', async () => {
    const service = new PlatformOperationsService(
      {
        listAudit: jest.fn(),
        listOperations: jest.fn(),
      },
      config({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://secret',
        REDIS_URL: 'redis://secret',
        WEB_ORIGIN: 'https://crm.example.com',
      }),
      {
        check: () => Promise.resolve({ database: false, redis: false }),
      } as never,
    );

    const result = await service.runtimeStatus();

    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'database', status: 'ACTION_REQUIRED' }),
        expect.objectContaining({ key: 'redis', status: 'ACTION_REQUIRED' }),
        expect.objectContaining({ key: 'sms', status: 'ACTION_REQUIRED' }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.policies).toMatchObject({
      sessionTtlDays: 30,
      sessionHistoryRetentionDays: 90,
      verificationRetentionDays: 30,
    });
  });
});

function config(values: Record<string, string>): ConfigService {
  return {
    get(key: string, fallback?: string) {
      return values[key] ?? fallback;
    },
  } as ConfigService;
}
