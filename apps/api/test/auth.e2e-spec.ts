import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';
import { DatabaseService } from '../src/infrastructure/database/database.service';

const origin = 'http://localhost:3000';
const phone = '13911112222';
const code = '123456';

describe('Auth API (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = code;
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
    app = (await createApp()) as INestApplication<App>;
    database = app.get(DatabaseService);
  });

  beforeEach(async () => {
    const existing = await database.client.user.findUnique({
      where: { phone: '+8613911112222' },
    });
    if (existing) {
      await database.client.session.deleteMany({
        where: { userId: existing.id },
      });
      await database.client.user.delete({ where: { id: existing.id } });
    }
    await database.client.verificationChallenge.deleteMany({
      where: { phone: '+8613911112222' },
    });
  });

  it('registers, authenticates, manages sessions, and resets the password', async () => {
    const first = request.agent(app.getHttpServer());

    await first
      .post('/api/v1/auth/verification-challenges')
      .set('Origin', origin)
      .send({ phone, purpose: 'REGISTER', deviceKey: 'browser-one' })
      .expect(202);
    const registration = await first
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        phone,
        code,
        displayName: '测试用户',
        password: 'old-password1',
        deviceSummary: 'Chrome / macOS',
      })
      .expect(201);
    expect(registration.body).toMatchObject({
      accepted: true,
      user: { phone: '+8613911112222', displayName: '测试用户' },
    });
    expect(registration.body).not.toHaveProperty('sessionToken');
    await first
      .get('/api/v1/me')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ phone: '+8613911112222' });
      });

    const second = request.agent(app.getHttpServer());
    await second
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({
        phone,
        password: 'old-password1',
        deviceKey: 'browser-two',
        deviceSummary: 'Safari / iPhone',
      })
      .expect(200);
    const sessions = await second
      .get('/api/v1/me/sessions?kind=ACTIVE&page=1&limit=100')
      .expect(200);

    expect(sessions.body).toMatchObject({
      page: 1,
      limit: 100,
      total: 2,
    });

    const sessionPage = sessions.body as {
      items: Array<Record<string, unknown>>;
      page: number;
      limit: number;
      total: number;
    };
    expect(sessionPage.items).toHaveLength(2);
    expect(sessionPage.items[0]).not.toHaveProperty('tokenHash');

    const oldSession = sessionPage.items.find(
      (item) => item.deviceSummary === 'Chrome / macOS',
    );
    expect(oldSession).toBeDefined();
    const oldSessionId = oldSession?.id;
    expect(typeof oldSessionId).toBe('string');
    await second
      .delete(`/api/v1/me/sessions/${oldSessionId}`)
      .set('Origin', origin)
      .expect(200);
    await first.get('/api/v1/me').expect(401);

    await second
      .post('/api/v1/auth/forgot-password')
      .set('Origin', origin)
      .send({ phone, deviceKey: 'browser-two' })
      .expect(202);
    await second
      .post('/api/v1/auth/reset-password')
      .set('Origin', origin)
      .send({ phone, code, newPassword: 'new-password1' })
      .expect(200);
    await second.get('/api/v1/me').expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({
        phone,
        password: 'old-password1',
        deviceKey: 'browser-three',
        deviceSummary: 'Firefox',
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({
        phone,
        password: 'new-password1',
        deviceKey: 'browser-three',
        deviceSummary: 'Firefox',
      })
      .expect(200);
  });

  it('revokes the current cookie on logout', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/verification-challenges')
      .set('Origin', origin)
      .send({ phone, purpose: 'REGISTER', deviceKey: 'browser-one' })
      .expect(202);
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        phone,
        code,
        displayName: '测试用户',
        password: 'old-password1',
        deviceSummary: 'Chrome',
      })
      .expect(201);
    await agent.post('/api/v1/auth/logout').set('Origin', origin).expect(200);
    await agent.get('/api/v1/me').expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
