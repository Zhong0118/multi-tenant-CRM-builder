import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Express } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';

import { ApiExceptionFilter } from '../../common/errors/api-exception.filter';
import { configureTrustedProxy } from '../../common/security/trusted-proxy';
import { InMemoryRateLimiter } from '../../infrastructure/rate-limit/rate-limiter';
import { AuthController } from './auth.controller';
import type { AuthChallenge, AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import type { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';

describe('SMS IP limits behind an exact trusted proxy', () => {
  it('separates real clients, rejects forged leftmost IPs, and ignores XFF from untrusted peers', async () => {
    const apps: INestApplication<App>[] = [];
    let sequence = 0;

    async function createHarness(proxyIp: string) {
      const challenges: AuthChallenge[] = [];
      const sentPhones: string[] = [];
      // Only persistence and delivery are replaced; IP extraction and all three
      // verification rate limits run through the real controller and service.
      const repository: Pick<
        AuthRepository,
        'pruneAuthArtifacts' | 'createChallenge'
      > = {
        pruneAuthArtifacts: async () => undefined,
        createChallenge: async (input) => {
          const challenge = { ...input, id: `challenge-${challenges.length}` };
          challenges.push(challenge);
          return challenge;
        },
      };
      const sessions = {} as SessionService;
      const auth = new AuthService(
        repository as AuthRepository,
        {
          send: async ({ phone }) => {
            sentPhones.push(phone);
          },
        },
        new InMemoryRateLimiter(),
        {} as PasswordHasher,
        sessions,
        () => new Date(),
        () => '123456',
      );
      const moduleRef = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: auth },
          { provide: SessionService, useValue: sessions },
        ],
      }).compile();
      const app = moduleRef.createNestApplication<INestApplication<App>>();
      apps.push(app);
      configureTrustedProxy(
        app.getHttpAdapter().getInstance() as Express,
        proxyIp,
      );
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      app.useGlobalFilters(new ApiExceptionFilter());
      await app.listen(0, '127.0.0.1');
      return { app, challenges, sentPhones };
    }

    function send(app: INestApplication<App>, forwardedFor: string) {
      sequence += 1;
      return request(app.getHttpServer())
        .post('/api/v1/auth/verification-challenges')
        .set('X-Forwarded-For', forwardedFor)
        .send({
          phone: `139${String(sequence).padStart(8, '0')}`,
          deviceKey: `unique-device-${sequence}`,
          purpose: 'RESET_PASSWORD',
        });
    }

    try {
      const trusted = await createHarness('127.0.0.1');
      for (let index = 0; index < 20; index += 1) {
        await send(trusted.app, `203.0.113.${index + 1}, 198.51.100.8`).expect(
          202,
          { accepted: true },
        );
      }
      const blocked = await send(
        trusted.app,
        '203.0.113.250, 198.51.100.8',
      ).expect(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
      expect(trusted.challenges).toHaveLength(20);
      expect(trusted.sentPhones).toHaveLength(20);
      expect(
        new Set(trusted.challenges.map((entry) => entry.requestIp)),
      ).toEqual(new Set(['198.51.100.8']));

      for (let index = 0; index < 20; index += 1) {
        await send(trusted.app, `203.0.113.${index + 1}, 198.51.100.9`).expect(
          202,
          { accepted: true },
        );
      }
      const secondBlocked = await send(
        trusted.app,
        '203.0.113.251, 198.51.100.9',
      ).expect(429);
      expect(secondBlocked.body.code).toBe('RATE_LIMITED');
      expect(trusted.sentPhones).toHaveLength(40);
      expect(
        trusted.challenges
          .slice(20)
          .every((entry) => entry.requestIp === '198.51.100.9'),
      ).toBe(true);

      const untrusted = await createHarness('192.0.2.2');
      for (let index = 0; index < 20; index += 1) {
        await send(untrusted.app, `198.51.100.${index + 1}`).expect(202, {
          accepted: true,
        });
      }
      const forged = await send(untrusted.app, '203.0.113.252').expect(429);
      expect(forged.body.code).toBe('RATE_LIMITED');
      expect(untrusted.sentPhones).toHaveLength(20);
      expect(
        new Set(untrusted.challenges.map((entry) => entry.requestIp)),
      ).toEqual(new Set(['127.0.0.1']));
    } finally {
      await Promise.all(apps.map((app) => app.close()));
    }
  });
});
