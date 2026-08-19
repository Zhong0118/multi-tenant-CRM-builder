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
});
