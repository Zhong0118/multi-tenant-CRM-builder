import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createApp } from './../src/bootstrap';

describe('Health API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = '123456';
    app = (await createApp()) as INestApplication<App>;
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'req_e2e_health')
      .expect(200)
      .expect('X-Request-Id', 'req_e2e_health')
      .expect({ status: 'ok', service: 'api' });
  });

  afterEach(async () => {
    await app.close();
  });
});
