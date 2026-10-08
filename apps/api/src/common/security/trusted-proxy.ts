import { isIP } from 'node:net';
import type { Express } from 'express';

// One explicitly configured reverse proxy; no subnet, boolean or hop-count trust.
export function configureTrustedProxy(app: Express, proxyIp?: string): void {
  if (proxyIp && !isIP(proxyIp)) {
    throw new Error('TRUSTED_PROXY_IP must be a single proxy IP address');
  }
  app.set('trust proxy', proxyIp || false);
}
