/**
 * §30: the correlation metadata of an Audit row written on behalf of a
 * Workflow Action. It is carried as data (not as a new column or table: V1 adds
 * neither) and merged into the audit payload next to the domain action, which
 * keeps its original name (`record.created`, `record.relation_added`,
 * `follow_up.created`, …).
 *
 * It lives beside `AuditEvent` because the records, relations and follow-ups
 * commands all need the shape while none of them may depend on the `actions`
 * module (that module depends on them).
 */
export interface WorkflowActionAuditMetadata {
  workflowExecutionId: string;
  transitionKey: string;
  actionKey: string;
  actionType: string;
}

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
