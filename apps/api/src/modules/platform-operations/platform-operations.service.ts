import { Inject, Injectable } from '@nestjs/common';
import { RuntimeHealthService } from './runtime-health.service';
import { ConfigService } from '@nestjs/config';

import { ApiException } from '../../common/errors/api.exception';
import type {
  PageResult,
  PlatformAuditFacets,
  PlatformAuditItem,
  PlatformAuditQuery,
  PlatformOperationItem,
  RuntimeStatus,
} from './platform-operations.types';

export const PLATFORM_OPERATIONS_REPOSITORY = Symbol(
  'PLATFORM_OPERATIONS_REPOSITORY',
);

export interface PlatformOperationsRepository {
  auditFacets(actorId: string, tenantId?: string): Promise<PlatformAuditFacets>;
  listAudit(
    actorId: string,
    query: PlatformAuditQuery,
  ): Promise<PageResult<PlatformAuditItem>>;
  listOperations(
    actorId: string,
    query: { page: number; limit: number },
  ): Promise<PageResult<PlatformOperationItem>>;
}

@Injectable()
export class PlatformOperationsService {
  constructor(
    @Inject(PLATFORM_OPERATIONS_REPOSITORY)
    private readonly repository: PlatformOperationsRepository,
    private readonly config: ConfigService,
    private readonly health: RuntimeHealthService,
  ) {}

  auditFacets(actorId: string, tenantId?: string) {
    return this.repository.auditFacets(actorId, tenantId);
  }

  listAudit(actorId: string, query: PlatformAuditQuery) {
    if (query.from && query.to && query.from > query.to)
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { from: ['开始日期不能晚于结束日期。'] },
      });
    return this.repository.listAudit(actorId, query);
  }

  listOperations(actorId: string, query: { page: number; limit: number }) {
    return this.repository.listOperations(actorId, query);
  }

  async runtimeStatus(): Promise<RuntimeStatus> {
    const health = await this.health.check();
    const environment = this.config.get<string>('NODE_ENV', 'development');
    const redisConfigured = Boolean(this.config.get<string>('REDIS_URL'));
    const webOriginConfigured = Boolean(this.config.get<string>('WEB_ORIGIN'));
    const fixedCodeConfigured = /^\d{6}$/.test(
      this.config.get<string>('DEV_VERIFICATION_CODE', ''),
    );
    const tencentConfigured =
      this.config.get<string>('SMS_PROVIDER') === 'tencent' &&
      [
        'TENCENT_SMS_SECRET_ID',
        'TENCENT_SMS_SECRET_KEY',
        'TENCENT_SMS_SDK_APP_ID',
        'TENCENT_SMS_SIGN_NAME',
        'TENCENT_SMS_REGISTER_TEMPLATE_ID',
        'TENCENT_SMS_RESET_TEMPLATE_ID',
      ].every((key) => Boolean(this.config.get<string>(key)?.trim())) &&
      Boolean(
        this.config.get<string>('TENCENT_SMS_REGION', 'ap-guangzhou').trim(),
      );
    return {
      environment,
      services: [
        {
          key: 'database',
          label: 'PostgreSQL 数据库',
          status: health.database ? 'READY' : 'ACTION_REQUIRED',
          detail: health.database
            ? '数据库实时探测成功。'
            : '数据库探测失败或超时。',
        },
        {
          key: 'redis',
          label: 'Redis 限流',
          status: redisConfigured
            ? health.redis
              ? 'READY'
              : 'ACTION_REQUIRED'
            : environment === 'production'
              ? 'ACTION_REQUIRED'
              : 'DEVELOPMENT',
          detail: redisConfigured
            ? health.redis
              ? 'Redis PING 探测成功。'
              : 'Redis 探测失败或超时。'
            : '未配置 Redis；非生产环境使用进程内限流。',
        },
        {
          key: 'sms',
          label: '短信验证码',
          status:
            environment === 'production'
              ? tencentConfigured
                ? 'READY'
                : 'ACTION_REQUIRED'
              : fixedCodeConfigured
                ? 'DEVELOPMENT'
                : 'ACTION_REQUIRED',
          detail:
            environment === 'production'
              ? tencentConfigured
                ? '腾讯云短信配置完整，已启用注册和重置密码模板。'
                : '腾讯云短信配置不完整，请检查供应商、凭据、签名和模板。'
              : fixedCodeConfigured
                ? '开发环境使用固定验证码，不会发送真实短信。'
                : '请配置六位开发验证码。',
        },
        {
          key: 'webOrigin',
          label: 'Web 来源限制',
          status: webOriginConfigured
            ? 'READY'
            : environment === 'production'
              ? 'ACTION_REQUIRED'
              : 'DEVELOPMENT',
          detail: webOriginConfigured
            ? '已配置允许访问 API 的 Web 来源。'
            : '开发环境使用本机默认来源。',
        },
      ],
      policies: {
        sessionTtlDays: 30,
        sessionHistoryRetentionDays: 90,
        verificationTtlMinutes: 10,
        verificationRetentionDays: 30,
      },
    };
  }
}
