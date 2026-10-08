import { ApiException } from '../../common/errors/api.exception';

export function registrationNeedsInvitation(
  phone: string,
  env: Record<string, string | undefined>,
): boolean {
  if (
    env.NODE_ENV !== 'production' ||
    env.PUBLIC_REGISTRATION_ENABLED === 'true'
  )
    return false;
  return !(env.FIRST_ADMIN_PHONE ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes(phone);
}

export function assertRegistrationAllowed(
  phone: string,
  env: Record<string, string | undefined>,
  hasPendingInvitation = false,
): void {
  if (registrationNeedsInvitation(phone, env) && !hasPendingInvitation) {
    throw new ApiException('AUTH_REQUIRED', 403);
  }
}
