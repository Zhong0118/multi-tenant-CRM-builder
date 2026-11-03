import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception';

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\+86)?1[3-9]\d{9}$/.test(value))
    throw new ApiException('FIELD_INVALID', 400, {
      message: '仅支持中国大陆手机号码或 +86 前缀。',
    });
  return value.replace(/^\+86/, '');
}
function encryptionKey(key: string): Buffer {
  if (!/^[a-f\d]{64}$/i.test(key))
    throw new ApiException('VALIDATION_FAILED', 503, {
      message: '电话加密密钥未正确配置。',
    });
  return Buffer.from(key, 'hex');
}
export function encryptSecret(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((part) => part.toString('base64'))
    .join('.');
}
export function decryptSecret(value: string, key: string): string {
  try {
    const [iv, tag, data] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(key), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new ApiException('VALIDATION_FAILED', 503, {
      message: '电话密钥不可用，请联系管理员。',
    });
  }
}
export function safeRecordingUrl(value: string): string {
  try {
    const url = new URL(value);
    // Recording URLs are links only, never fetched by this service. Reject local/IP/credential URLs.
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !url.hostname.includes('.') ||
      /^[\d.]+$/.test(url.hostname) ||
      /[:\]]/.test(url.hostname) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)
    )
      throw new Error('invalid');
    return url.toString();
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '录音地址必须是公开 HTTPS 地址。',
    });
  }
}
export type DialResult = {
  status: 'ACCEPTED' | 'UNKNOWN' | 'FAILED';
  providerBindId: string | null;
};
@Injectable()
export class KuaimaProvider {
  async dial(
    input: {
      companyId: string;
      appSecret: string;
      caller: string;
      callee: string;
    },
    transport: typeof fetch = fetch,
    ts = Math.floor(Date.now() / 1000),
  ): Promise<DialResult> {
    const body = new URLSearchParams({
      company_id: input.companyId,
      ts: String(ts),
      sign: createHash('md5')
        .update(`${input.companyId}${input.appSecret}${ts}`)
        .digest('hex')
        .toUpperCase(),
      api_type: 'companyapi',
      type: '2',
      caller: input.caller,
      callee: input.callee,
    });
    try {
      const response = await transport(
        'https://www.kuaimatongxun.com/api/call/callBind',
        {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        },
      );
      if (!response.ok) return { status: 'UNKNOWN', providerBindId: null };
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object' && 'code' in payload) {
        const code =
          typeof payload.code === 'number'
            ? payload.code
            : typeof payload.code === 'string' && /^-?\d+$/.test(payload.code)
              ? Number(payload.code)
              : NaN;
        if (
          code === 1 &&
          'bind_id' in payload &&
          typeof payload.bind_id === 'string' &&
          payload.bind_id.trim() &&
          payload.bind_id.length <= 200
        )
          return { status: 'ACCEPTED', providerBindId: payload.bind_id };
        if (Number.isFinite(code) && code !== 1)
          return { status: 'FAILED', providerBindId: null };
      }
    } catch {
      /* Ambiguous submission: never retry a dial or expose provider payloads. */
    }
    return { status: 'UNKNOWN', providerBindId: null };
  }
}
