import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception';
import { ModelKeyring, type Envelope } from '../../ai/governance/model-secrets';

export const KUAIMA_ORIGIN = 'https://www.kuaimatongxun.com';
const KUAIMA_DIAL_PATH = '/api/call/callBind';

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\+86)?1[3-9]\d{9}$/.test(value))
    throw new ApiException('FIELD_INVALID', 400, {
      message: '仅支持中国大陆手机号码或 +86 前缀。',
    });
  return value.replace(/^\+86/, '');
}

export type TelephonySecretKind = 'appSecret' | 'callbackToken';

/**
 * Supplier secrets are sealed with the API's master keyring (the same one that
 * protects model keys), bound by AAD to this purpose and tenant so an envelope
 * cannot be replayed into another column or company.
 */
export class TelephonyVault {
  private cached?: { raw: string | undefined; keyring: ModelKeyring };
  constructor(private readonly raw: () => string | undefined) {}

  private ring(): ModelKeyring {
    try {
      const raw = this.raw();
      if (!this.cached || this.cached.raw !== raw)
        this.cached = { raw, keyring: new ModelKeyring(raw) };
      return this.cached.keyring;
    } catch {
      throw new ApiException('VALIDATION_FAILED', 503, {
        message: '电话密钥不可用：服务器主密钥环未配置。',
      });
    }
  }
  seal(tenantId: string, kind: TelephonySecretKind, value: string): string {
    return JSON.stringify(
      this.ring().seal('telephony', `${tenantId}:${kind}`, value),
    );
  }
  open(tenantId: string, kind: TelephonySecretKind, stored: string): string {
    const ring = this.ring();
    try {
      return ring.open(
        'telephony',
        `${tenantId}:${kind}`,
        JSON.parse(stored) as Envelope,
      );
    } catch {
      throw new ApiException('VALIDATION_FAILED', 503, {
        message: '电话密钥不可用，请管理员重新填写。',
      });
    }
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
  /** The supplier's own short refusal text (never the full response). */
  failureReason: string | null;
};

function refusal(message: unknown, secrets: string[]): string | null {
  if (typeof message !== 'string') return null;
  const text = [...message]
    .map((char) => (char < ' ' || char === '\u007f' ? ' ' : char))
    .join('')
    .trim();
  if (!text || secrets.some((secret) => secret && text.includes(secret)))
    return null;
  return text.slice(0, 120);
}

@Injectable()
export class KuaimaProvider {
  /**
   * 企业拨打&绑定-快捷模式. `code=1` with `data.bind_id` only means the supplier
   * accepted the request; it says nothing about whether anyone answered.
   */
  async dial(
    input: {
      companyId: string;
      appSecret: string;
      caller: string;
      callee: string;
    },
    transport: typeof fetch = fetch,
    ts = Math.floor(Date.now() / 1000),
    origin = KUAIMA_ORIGIN,
  ): Promise<DialResult> {
    const body = new URLSearchParams({
      company_id: input.companyId,
      ts: String(ts),
      sign: createHash('md5')
        .update(`${input.companyId}${input.appSecret}${ts}`)
        .digest('hex')
        .toUpperCase(),
      // The parameter table says api_type, the example says platform; both
      // name the same switch and the supplier ignores unknown form fields.
      api_type: 'companyapi',
      platform: 'companyapi',
      type: '2',
      caller: input.caller,
      callee: input.callee,
    });
    try {
      const response = await transport(`${origin}${KUAIMA_DIAL_PATH}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok)
        return { status: 'UNKNOWN', providerBindId: null, failureReason: null };
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object' && 'code' in payload) {
        const code =
          typeof payload.code === 'number'
            ? payload.code
            : typeof payload.code === 'string' && /^-?\d+$/.test(payload.code)
              ? Number(payload.code)
              : NaN;
        const data =
          'data' in payload && payload.data && typeof payload.data === 'object'
            ? (payload.data as Record<string, unknown>)
            : null;
        const bindId = data?.bind_id;
        if (
          code === 1 &&
          typeof bindId === 'string' &&
          bindId.trim() &&
          bindId.length <= 200
        )
          return {
            status: 'ACCEPTED',
            providerBindId: bindId,
            failureReason: null,
          };
        if (Number.isFinite(code) && code !== 1)
          return {
            status: 'FAILED',
            providerBindId: null,
            failureReason: refusal(
              'msg' in payload
                ? payload.msg
                : 'info' in payload
                  ? payload.info
                  : null,
              [input.appSecret],
            ),
          };
      }
    } catch {
      /* Ambiguous submission: never retry a dial or expose provider payloads. */
    }
    return { status: 'UNKNOWN', providerBindId: null, failureReason: null };
  }
}
