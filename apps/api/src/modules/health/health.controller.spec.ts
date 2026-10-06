import { Test } from '@nestjs/testing';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports that the API is available', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = moduleRef.get(HealthController);

    expect(controller.check()).toEqual({ status: 'ok', service: 'api' });
  });

  it('reports readiness only when dependencies are ready', async () => {
    const controller = new HealthController({ check: async () => ({ database: true, redis: false }) } as never);
    await expect(controller.readiness()).rejects.toMatchObject({ status: 503 });
  });
});
