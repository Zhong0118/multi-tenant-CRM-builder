import { createHash, createHmac } from 'node:crypto';

export const VERIFICATION_SENDER = Symbol('VERIFICATION_SENDER');

export type VerificationPurpose = 'REGISTER' | 'RESET_PASSWORD';

export interface VerificationSender {
  send(input: {
    phone: string;
    code: string;
    purpose: VerificationPurpose;
  }): Promise<void>;
}

export interface TencentSmsConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  signName: string;
  registerTemplateId: string;
  resetTemplateId: string;
  region: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
}

class FixedCodeVerificationSender implements VerificationSender {
  constructor(private readonly expectedCode: string) {}

  send(input: {
    phone: string;
    code: string;
    purpose: VerificationPurpose;
  }): Promise<void> {
    if (input.code !== this.expectedCode) {
      return Promise.reject(
        new Error('Generated verification code does not match fixed code'),
      );
    }
    return Promise.resolve();
  }
}

class TencentSmsVerificationSender implements VerificationSender {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: TencentSmsConfig) {
    this.fetcher = config.fetcher ?? fetch;
    this.now = config.now ?? Date.now;
  }

  async send(input: {
    phone: string;
    code: string;
    purpose: VerificationPurpose;
  }): Promise<void> {
    const payload = JSON.stringify({
      SmsSdkAppId: this.config.sdkAppId,
      SignName: this.config.signName,
      TemplateId:
        input.purpose === 'REGISTER'
          ? this.config.registerTemplateId
          : this.config.resetTemplateId,
      TemplateParamSet: [input.code],
      PhoneNumberSet: [input.phone],
    });
    const timestamp = Math.floor(this.now() / 1000);
    const host = 'sms.tencentcloudapi.com';
    const headers = {
      Authorization: createAuthorization(
        this.config.secretId,
        this.config.secretKey,
        host,
        'sms',
        'SendSms',
        timestamp,
        payload,
      ),
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': 'SendSms',
      'X-TC-Region': this.config.region,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2019-07-11',
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs ?? 10_000,
      );
      try {
        const response = await this.fetcher(`https://${host}`, {
          method: 'POST',
          headers,
          body: payload,
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          Response?: {
            Error?: unknown;
            SendStatusSet?: Array<{
              Code?: string;
              PhoneNumber?: string;
            }>;
          };
        };
        const status = body.Response?.SendStatusSet;
        if (
          !response.ok ||
          body.Response?.Error ||
          !status ||
          status.length !== 1 ||
          status[0]?.Code !== 'Ok' ||
          status[0]?.PhoneNumber !== input.phone
        ) {
          throw new Error('Tencent SMS request was rejected');
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      throw new Error('Verification SMS provider request failed');
    }
  }
}

export function createVerificationSender(
  nodeEnv: string,
  fixedCode?: string,
  tencentConfig?: TencentSmsConfig,
): VerificationSender {
  if (nodeEnv === 'production') {
    if (!tencentConfig || !isCompleteTencentConfig(tencentConfig)) {
      throw new Error('Production verification sender is not configured');
    }
    return new TencentSmsVerificationSender(tencentConfig);
  }
  if (!fixedCode || !/^\d{6}$/.test(fixedCode)) {
    throw new Error('DEV_VERIFICATION_CODE must be exactly six digits');
  }
  return new FixedCodeVerificationSender(fixedCode);
}

function isCompleteTencentConfig(config: TencentSmsConfig): boolean {
  return [
    config.secretId,
    config.secretKey,
    config.sdkAppId,
    config.signName,
    config.registerTemplateId,
    config.resetTemplateId,
    config.region,
  ].every((value) => typeof value === 'string' && value.trim().length > 0);
}

function createAuthorization(
  secretId: string,
  secretKey: string,
  host: string,
  service: string,
  action: string,
  timestamp: number,
  payload: string,
): string {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload),
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
