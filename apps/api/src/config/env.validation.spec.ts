import { validateProductionConfig } from './env.validation';

describe('validateProductionConfig', () => {
  const valid = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://runtime:secret@db.example.test:5432/crm',
    REDIS_URL: 'rediss://:secret@redis.example.test:6380',
    WEB_ORIGIN: 'https://app.example.test',
    API_ORIGIN: 'https://api.example.test',
    PUBLIC_REGISTRATION_ENABLED: 'false',
    FIRST_ADMIN_PHONE: '+8613800138000',
    AI_PROVIDER: 'openai',
    AI_MODEL: 'trial-model',
    AI_API_KEY: 'test-key',
    ATTACHMENTS_STORAGE_DIR: '/var/lib/crm/attachments',
    SMS_PROVIDER: 'tencent',
    TENCENT_SMS_SECRET_ID: 'test-id',
    TENCENT_SMS_SECRET_KEY: 'test-key',
    TENCENT_SMS_SDK_APP_ID: '123',
    TENCENT_SMS_SIGN_NAME: 'test-sign',
    TENCENT_SMS_REGISTER_TEMPLATE_ID: '123',
    TENCENT_SMS_RESET_TEMPLATE_ID: '456',
  };

  it('accepts production runtime configuration', () => {
    expect(validateProductionConfig(valid)).toEqual(valid);
  });

  it('preserves validated provider and runtime configuration', () => {
    const env = {
      ...valid,
      SMS_PROVIDER: 'tencent',
      AI_MODEL: 'trial-model',
      PORT: '3101',
    };
    expect(validateProductionConfig(env)).toEqual(env);
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: 'http://db.example.test' }],
    ['DATABASE_URL', { DATABASE_URL: '' }],
    ['TRUSTED_PROXY_IP', { TRUSTED_PROXY_IP: 'true' }],
    ['TRUSTED_PROXY_IP', { TRUSTED_PROXY_IP: '172.16.0.0/12' }],
    ['AI_API_KEY', { AI_API_KEY: '' }],
    ['AI_PROVIDER', { AI_PROVIDER: 'fake' }],
    ['AI_BASE_URL', { AI_BASE_URL: 'http://ai.example.test' }],
    ['SMS_PROVIDER', { SMS_PROVIDER: 'fake' }],
    ['TENCENT_SMS_SECRET_KEY', { TENCENT_SMS_SECRET_KEY: '   ' }],
    ['ATTACHMENTS_STORAGE_DIR', { ATTACHMENTS_STORAGE_DIR: 'relative/path' }],
    ['REDIS_URL', { REDIS_URL: 'http://redis.example.test' }],
    ['WEB_ORIGIN', { WEB_ORIGIN: 'http://app.example.test' }],
    ['API_ORIGIN', { API_ORIGIN: 'http://api.example.test' }],
  ])('rejects unsafe production %s', (_name, override) => {
    expect(() => validateProductionConfig({ ...valid, ...override })).toThrow(
      /Invalid production configuration/,
    );
  });

  it('rejects public registration in production', () => {
    expect(() =>
      validateProductionConfig({
        ...valid,
        PUBLIC_REGISTRATION_ENABLED: 'true',
      }),
    ).toThrow(/PUBLIC_REGISTRATION_ENABLED/);
  });
});
