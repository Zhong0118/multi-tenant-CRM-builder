import { assertRegistrationAllowed } from './registration-policy';

describe('registration policy', () => {
  it('allows an allowlisted phone when public registration is disabled', () => {
    expect(() => assertRegistrationAllowed('+8613800138000', {
      NODE_ENV: 'production', PUBLIC_REGISTRATION_ENABLED: 'false', FIRST_ADMIN_PHONE: '+8613800138000',
    })).not.toThrow();
  });

  it('allows a pending invitation when public registration is disabled', () => {
    expect(() => assertRegistrationAllowed('+8613800138001', {
      NODE_ENV: 'production', PUBLIC_REGISTRATION_ENABLED: 'false', FIRST_ADMIN_PHONE: '+8613800138000',
    }, true)).not.toThrow();
  });

  it('rejects a non-allowlisted phone without an invitation with generic auth error', () => {
    expect(() => assertRegistrationAllowed('+8613800138001', {
      NODE_ENV: 'production', PUBLIC_REGISTRATION_ENABLED: 'false', FIRST_ADMIN_PHONE: '+8613800138000',
    }, false)).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED', status: 403 }));
  });

  it('leaves development registration unchanged', () => {
    expect(() => assertRegistrationAllowed('+8613800138001', {
      NODE_ENV: 'development', PUBLIC_REGISTRATION_ENABLED: 'false',
    })).not.toThrow();
  });
});
