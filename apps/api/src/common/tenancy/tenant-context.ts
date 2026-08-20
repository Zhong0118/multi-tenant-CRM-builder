export interface AuthenticatedUser {
  id: string;
  phone: string;
  isPlatformAdmin: boolean;
}

export interface TenantContext {
  userId: string;
  tenantId: string;
  tenantCode: string;
  memberId: string;
  role: 'TENANT_ADMIN' | 'EMPLOYEE';
}
