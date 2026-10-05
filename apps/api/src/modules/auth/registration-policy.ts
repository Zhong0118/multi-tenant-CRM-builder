import { ApiException } from '../../common/errors/api.exception';

export function assertRegistrationAllowed(phone: string, env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'production' || env.PUBLIC_REGISTRATION_ENABLED === 'true') return;
  const allowed = (env.FIRST_ADMIN_PHONE ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(phone)) throw new ApiException('AUTH_REQUIRED', 403);
}
