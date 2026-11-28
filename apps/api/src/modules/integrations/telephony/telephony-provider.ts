import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception';
import { ModelKeyring, type Envelope } from '../../ai/governance/model-secrets';

export const KUAIMA_ORIGIN = 'https://www.kuaimatongxun.com';
const KUAIMA_DIAL_PATH = '/api/call/callBind';
const SEAT_LIST_PATH = '/api/company/getSeatsList';
const SEAT_CREATE_PATH = '/api/company/createSeats';
const SEAT_UPDATE_PATH = '/api/company/updateSeats';

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\+86)?1[3-9]\d{9}$/.test(value))
    throw new ApiException('FIELD_INVALID', 400, {
      message: '仅支持中国大陆手机号码或 +86 前缀。',
    });
  return value.replace(/^\+86/, '');
}

export type TelephonySecretKind = 'appSecret' | 'callbackToken';

/**
 * The platform's supplier secrets are sealed with the API's master keyring (the
 * same one that protects model keys), bound by AAD to their column so an
 * envelope cannot be replayed into the other one.
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
  seal(kind: TelephonySecretKind, value: string): string {
    return JSON.stringify(
      this.ring().seal('telephony', `platform:${kind}`, value),
    );
  }
  open(kind: TelephonySecretKind, stored: string): string {
    const ring = this.ring();
    try {
      return ring.open(
        'telephony',
        `platform:${kind}`,
        JSON.parse(stored) as Envelope,
      );
    } catch {
      throw new ApiException('VALIDATION_FAILED', 503, {
        message: '电话密钥不可用，请平台管理员重新填写。',
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
export type KuaimaAccount = {
  companyId: string;
  appSecret: string;
  origin: string;
};
export type KuaimaSeat = { id: string; username: string; mobile: string };
/** The supplier refused or could not be reached; `reason` is safe to show. */
export class KuaimaSeatError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'KuaimaSeatError';
  }
}

/** 接口签名：MD5(company_id + app_secret + ts)，转大写。 */
export function signature(companyId: string, appSecret: string, ts: number) {
  return createHash('md5')
    .update(`${companyId}${appSecret}${ts}`)
    .digest('hex')
    .toUpperCase();
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function codeOf(payload: Record<string, unknown>): number {
  const code = payload.code;
  return typeof code === 'number'
    ? code
    : typeof code === 'string' && /^-?\d+$/.test(code)
      ? Number(code)
      : NaN;
}
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
const now = () => Math.floor(Date.now() / 1000);
const UNKNOWN: DialResult = {
  status: 'UNKNOWN',
  providerBindId: null,
  failureReason: null,
};

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
    ts = now(),
    origin = KUAIMA_ORIGIN,
  ): Promise<DialResult> {
    const body = new URLSearchParams({
      company_id: input.companyId,
      ts: String(ts),
      sign: signature(input.companyId, input.appSecret, ts),
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
      if (!response.ok) return UNKNOWN;
      const payload = objectOf(await response.json());
      if (payload && 'code' in payload) {
        const code = codeOf(payload);
        const bindId = objectOf(payload.data)?.bind_id;
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
            failureReason: refusal(payload.msg ?? payload.info, [
              input.appSecret,
            ]),
          };
      }
    } catch {
      /* Ambiguous submission: never retry a dial or expose provider payloads. */
    }
    return UNKNOWN;
  }

  /** 获取坐席列表, filtered to the exact account name. */
  async findSeat(
    account: KuaimaAccount,
    username: string,
    transport: typeof fetch = fetch,
    ts = now(),
  ): Promise<KuaimaSeat | null> {
    const payload = await this.enterprise(
      account,
      SEAT_LIST_PATH,
      { page: '1', limit: '10', username },
      [],
      transport,
      ts,
    );
    const list = objectOf(payload.data)?.list;
    for (const entry of Array.isArray(list) ? (list as unknown[]) : []) {
      const seat = objectOf(entry);
      if (!seat || seat.username !== username) continue;
      const id = seat.id;
      if (
        (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
        (typeof id === 'string' && /^\d{1,20}$/.test(id))
      )
        return {
          id: String(id),
          username,
          mobile: typeof seat.mobile === 'string' ? seat.mobile : '',
        };
    }
    return null;
  }

  /** 添加坐席. The password is random and never stored or echoed. */
  async createSeat(
    account: KuaimaAccount,
    seat: {
      username: string;
      nickname: string;
      mobile: string;
      password: string;
    },
    transport: typeof fetch = fetch,
    ts = now(),
  ): Promise<void> {
    await this.enterprise(
      account,
      SEAT_CREATE_PATH,
      { seats: JSON.stringify([seat]) },
      [seat.password],
      transport,
      ts,
    );
  }

  /** 更新坐席: the answering mobile and display name. */
  async updateSeat(
    account: KuaimaAccount,
    seatId: string,
    changes: { mobile: string; nickname: string },
    transport: typeof fetch = fetch,
    ts = now(),
  ): Promise<void> {
    await this.enterprise(
      account,
      SEAT_UPDATE_PATH,
      { seats_id: seatId, ...changes },
      [],
      transport,
      ts,
    );
  }

  /** One signed enterprise call; anything but `code=1` is a KuaimaSeatError. */
  private async enterprise(
    account: KuaimaAccount,
    path: string,
    fields: Record<string, string>,
    secrets: string[],
    transport: typeof fetch,
    ts: number,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      company_id: account.companyId,
      ts: String(ts),
      sign: signature(account.companyId, account.appSecret, ts),
      ...fields,
    });
    let response: Response;
    try {
      response = await transport(`${account.origin}${path}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      throw new KuaimaSeatError('快马接口无响应，请稍后重试');
    }
    if (!response.ok)
      throw new KuaimaSeatError(`快马接口返回 HTTP ${response.status}`);
    const payload = objectOf(await response.json().catch(() => null));
    if (!payload) throw new KuaimaSeatError('快马接口返回了无法识别的内容');
    if (codeOf(payload) !== 1)
      throw new KuaimaSeatError(
        refusal(payload.msg ?? payload.info, [account.appSecret, ...secrets]) ??
          '快马拒绝了请求',
      );
    return payload;
  }
}
