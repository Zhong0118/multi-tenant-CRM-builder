import type { Express } from 'express';
import request from 'supertest';
import { configureTrustedProxy } from './trusted-proxy';

// Exercise the request IP used by AuthController, rather than a mocked setter.
const express = require('express') as () => Express;

describe('bounded proxy trust', () => {
  function app(proxy?: string) {
    const server = express();
    configureTrustedProxy(server, proxy);
    server.get('/ip', (req, res) => res.json({ ip: req.ip }));
    return server;
  }

  it('ignores forged forwarding headers from an untrusted peer', async () => {
    const result = await request(app('192.0.2.2'))
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.8');
    expect(result.body.ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('defaults to no proxy trust', async () => {
    const result = await request(app())
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.8');
    expect(result.body.ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('separates clients and uses the nearest untrusted address', async () => {
    const server = app('::ffff:127.0.0.1');
    const first = await request(server)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99, 198.51.100.8');
    const second = await request(server)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99, 198.51.100.9');
    expect(first.body.ip).toBe('198.51.100.8');
    expect(second.body.ip).toBe('198.51.100.9');
  });

  it.each(['true', '1', 'loopback', '172.16.0.0/12', '0.0.0.0/0'])(
    'rejects broad or hop-count trust %s',
    (value) => {
      expect(() => app(value)).toThrow(/TRUSTED_PROXY_IP/);
    },
  );
});
