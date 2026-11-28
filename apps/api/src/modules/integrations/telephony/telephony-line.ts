import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import {
  KUAIMA_ORIGIN,
  TelephonyVault,
  type KuaimaAccount,
} from './telephony-provider';

export type LineMode = 'MOCK' | 'KUAIMA';
export type LineRow = {
  mode: LineMode;
  companyId: string;
  appSecretEncrypted: string | null;
  callbackTokenEncrypted: string | null;
};
export type Usage = {
  /** First day of the company's current month, `YYYY-MM-DD`. */
  month: string;
  planId: string | null;
  planName: string | null;
  seats: number;
  monthlyMinutes: number;
  usedMinutes: number;
  extraMinutes: number;
  seatsEnabled: number;
};

/** The company's plan and this month's usage; platform admins and members only. */
export async function readUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<Usage> {
  const [row] = await tx.$queryRaw<
    Array<{
      month: string | null;
      plan_id: string | null;
      plan_name: string | null;
      seats: number;
      monthly_minutes: number;
      used_minutes: number;
      extra_minutes: number;
      seats_enabled: number;
    }>
  >`SELECT to_char(u.month, 'YYYY-MM-DD') AS month, u.plan_id::text AS plan_id, u.plan_name, u.seats, u.monthly_minutes, u.used_minutes, u.extra_minutes, u.seats_enabled FROM telephony_usage(${tenantId}::uuid) u`;
  if (!row?.month) throw new ApiException('TENANT_NOT_FOUND', 404);
  return {
    month: row.month,
    planId: row.plan_id,
    planName: row.plan_name,
    seats: row.seats,
    monthlyMinutes: row.monthly_minutes,
    usedMinutes: row.used_minutes,
    extraMinutes: row.extra_minutes,
    seatsEnabled: row.seats_enabled,
  };
}

export const allowance = (usage: Usage) =>
  usage.monthlyMinutes + usage.extraMinutes;

/**
 * The platform's one supplier line. Every company dials through it; which
 * piece is missing is shown only on the platform's line page.
 */
@Injectable()
export class TelephonyLine {
  readonly vault: TelephonyVault;
  constructor(private readonly config: ConfigService) {
    this.vault = new TelephonyVault(() =>
      this.config.get<string>('AI_MODEL_KEYRING'),
    );
  }

  production() {
    return this.config.get('NODE_ENV') === 'production';
  }
  liveEnabled() {
    return (
      this.config.get<string>('TELEPHONY_LIVE_ENABLED', 'false') === 'true'
    );
  }
  /**
   * The supplier origin is fixed. Outside production a loopback fake supplier
   * may stand in for it, so the whole live path can be rehearsed locally.
   */
  kuaimaOrigin() {
    const override = this.config.get<string>('TELEPHONY_KUAIMA_ORIGIN', '');
    if (!override || this.production()) return KUAIMA_ORIGIN;
    const url = new URL(override);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      return KUAIMA_ORIGIN;
    return url.origin;
  }
  callbackEndpoint() {
    const origin = this.config
      .get<string>('API_ORIGIN', 'http://localhost:3001')
      .replace(/\/+$/, '');
    return `${origin}/api/v1/telephony/hooks`;
  }

  async read(tx: Prisma.TransactionClient): Promise<LineRow> {
    const [row] = await tx.$queryRaw<
      Array<{
        mode: LineMode;
        company_id: string;
        app_secret_encrypted: string | null;
        callback_token_encrypted: string | null;
      }>
    >`SELECT mode, company_id, app_secret_encrypted, callback_token_encrypted FROM telephony_line()`;
    return {
      mode: row?.mode ?? 'MOCK',
      companyId: row?.company_id ?? '',
      appSecretEncrypted: row?.app_secret_encrypted ?? null,
      callbackTokenEncrypted: row?.callback_token_encrypted ?? null,
    };
  }

  /** Empty when the line can dial; otherwise what the platform must fix. */
  problems(line: LineRow): string[] {
    if (line.mode === 'MOCK')
      return this.production() ? ['正式环境不能用模拟线路'] : [];
    const problems: string[] = [];
    if (!line.companyId) problems.push('企业 ID 未填写');
    if (!line.appSecretEncrypted) problems.push('企业密钥未填写');
    if (!line.callbackTokenEncrypted) problems.push('回调地址未生成');
    if (!this.liveEnabled())
      problems.push('服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）');
    if (line.appSecretEncrypted && line.callbackTokenEncrypted)
      try {
        this.vault.open('appSecret', line.appSecretEncrypted);
        this.vault.open('callbackToken', line.callbackTokenEncrypted);
      } catch {
        problems.push('密钥无法解开，请重新填写企业密钥并重新生成回调地址');
      }
    return problems;
  }

  /** The supplier account; only call when `problems(line)` is empty. */
  account(line: LineRow): KuaimaAccount {
    return {
      companyId: line.companyId,
      appSecret: this.vault.open('appSecret', line.appSecretEncrypted ?? ''),
      origin: this.kuaimaOrigin(),
    };
  }
}
