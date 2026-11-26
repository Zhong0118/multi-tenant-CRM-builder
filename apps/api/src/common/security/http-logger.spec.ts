import express from 'express';
import request from 'supertest';
import { createHttpLogger, HTTP_LOG_REDACT_PATHS } from './http-logger';

describe('HTTP logger redaction', () => {
  it('keeps account secrets, query strings and referrers out of HTTP logs', async () => {
    let log = '';
    const app = express();
    app.use(
      createHttpLogger({
        write(chunk) {
          log += chunk;
        },
      }),
    );
    app.use((_req, res) => res.sendStatus(200));
    const secret = 'email-privacy-sentinel';
    await request(app)
      .post('/api/v1/me/email/verify?code=' + secret)
      .send({ email: secret, code: secret })
      .expect(200);
    await request(app)
      .get('/api/v1/health?code=' + secret)
      .set('Referer', 'https://crm.example.test/?code=' + secret)
      .expect(200);
    expect(log).toContain('/api/v1/health');
    expect(log).not.toContain('/me/email');
    expect(log).not.toContain(secret);
  });

  it('redacts session-bearing request and response headers', () => {
    expect(HTTP_LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining(['req.headers.cookie', 'res.headers.set-cookie']),
    );
  });
});
