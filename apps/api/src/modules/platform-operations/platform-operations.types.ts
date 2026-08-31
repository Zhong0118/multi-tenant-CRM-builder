export interface PageResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface PlatformAuditQuery {
  page: number;
  limit: number;
  tenantId?: string;
  action?: string;
  resourceType?: string;
}

export interface PlatformAuditItem {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  actorType: 'USER' | 'SYSTEM' | 'INTEGRATION';
  actorId: string | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string;
  ip: string | null;
  createdAt: Date;
}

export interface PlatformOperationItem {
  id: string;
  kind: 'TEMPLATE_APPLICATION';
  status: 'SUCCEEDED';
  templateId: string;
  templateName: string;
  templateVersionNo: number;
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  appliedByUserId: string;
  appliedByName: string;
  objectCount: number;
  appliedAt: Date;
}

export interface RuntimeStatus {
  environment: string;
  services: Array<{
    key: 'database' | 'redis' | 'sms' | 'webOrigin';
    label: string;
    status: 'READY' | 'DEVELOPMENT' | 'ACTION_REQUIRED';
    detail: string;
  }>;
  policies: {
    sessionTtlDays: 30;
    sessionHistoryRetentionDays: 90;
    verificationTtlMinutes: 10;
    verificationRetentionDays: 30;
  };
}
