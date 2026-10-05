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
  };

  it('accepts production runtime configuration', () => {
    expect(validateProductionConfig(valid)).toEqual(valid);
  });

  it.each([
    ['DATABASE_URL', { DATABASE_URL: 'http://db.example.test' }],
    ['DATABASE_URL', { DATABASE_URL: '' }],
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
      validateProductionConfig({ ...valid, PUBLIC_REGISTRATION_ENABLED: 'true' }),
    ).toThrow(/PUBLIC_REGISTRATION_ENABLED/);
  });
});
