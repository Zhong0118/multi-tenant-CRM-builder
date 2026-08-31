import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  PageResult,
  PlatformAuditItem,
  PlatformAuditQuery,
  PlatformOperationItem,
  RuntimeStatus,
} from './platform-operations.types';

export const PLATFORM_OPERATIONS_REPOSITORY = Symbol(
  'PLATFORM_OPERATIONS_REPOSITORY',
);

export interface PlatformOperationsRepository {
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
  ) {}

  listAudit(actorId: string, query: PlatformAuditQuery) {
    return this.repository.listAudit(actorId, query);
  }

  listOperations(actorId: string, query: { page: number; limit: number }) {
    return this.repository.listOperations(actorId, query);
  }

  runtimeStatus(): RuntimeStatus {
    const environment = this.config.get<string>('NODE_ENV', 'development');
    const redisConfigured = Boolean(this.config.get<string>('REDIS_URL'));
    const webOriginConfigured = Boolean(this.config.get<string>('WEB_ORIGIN'));
    const fixedCodeConfigured = /^\d{6}$/.test(
      this.config.get<string>('DEV_VERIFICATION_CODE', ''),
    );
    return {
      environment,
      services: [
        {
          key: 'database',
          label: 'PostgreSQL 数据库',
          status: 'READY',
          detail: '当前请求已通过数据库读取，连接可用。',
        },
        {
          key: 'redis',
          label: 'Redis 限流',
          status: redisConfigured
            ? 'READY'
            : environment === 'production'
              ? 'ACTION_REQUIRED'
              : 'DEVELOPMENT',
          detail: redisConfigured
            ? '已配置 Redis 限流存储。'
            : '未配置 Redis；非生产环境使用进程内限流。',
        },
        {
          key: 'sms',
          label: '短信验证码',
          status:
            environment === 'production'
              ? 'ACTION_REQUIRED'
              : fixedCodeConfigured
                ? 'DEVELOPMENT'
                : 'ACTION_REQUIRED',
          detail:
            environment === 'production'
              ? '尚未接入生产短信供应商。'
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
