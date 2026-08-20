export interface AuditEvent {
  tenantId?: string;
  actorType: 'USER' | 'SYSTEM';
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  requestId: string;
  ip?: string;
}
