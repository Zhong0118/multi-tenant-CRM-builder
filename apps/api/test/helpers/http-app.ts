import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

import { createApp } from '../../src/bootstrap';

export async function createHttpTestApp(): Promise<INestApplication<App>> {
  const app = await createApp();
  // Supertest connects over IPv4. Hold one loopback listener for the fixture.
  await app.listen(0, '127.0.0.1');
  return app;
}
