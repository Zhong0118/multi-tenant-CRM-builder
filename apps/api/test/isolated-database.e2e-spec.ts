import { assertIsolatedTestDatabase } from './helpers/isolated-database';

const runtime =
  'postgresql://crm_app:crm_app@127.0.0.1:55433/crm_backend_test_1025';
const admin = 'postgresql://crm:crm@127.0.0.1:55433/crm_backend_test_1025';

describe('isolated test database guard', () => {
  it.each([
    ['127.0.0.1', '55433', 'crm_backend_test_1025'],
    ['localhost', '5433', 'crm_test'],
    ['[::1]', '5433', 'crm_v1b_test'],
  ])('accepts explicit local test database %s:%s/%s', (host, port, name) => {
    expect(() =>
      assertIsolatedTestDatabase(
        `postgresql://crm_app:crm_app@${host}:${port}/${name}`,
        `postgresql://crm:crm@${host}:${port}/${name}`,
      ),
    ).not.toThrow();
  });

  it.each([
    ['missing runtime URL', undefined, admin],
    ['missing admin URL', runtime, undefined],
    [
      'production database',
      runtime.replace('crm_backend_test_1025', 'crm'),
      admin.replace('crm_backend_test_1025', 'crm'),
    ],
    [
      'misleading database name',
      runtime.replace('crm_backend_test_1025', 'crm_latest'),
      admin.replace('crm_backend_test_1025', 'crm_latest'),
    ],
    [
      'remote host',
      runtime.replace('127.0.0.1', 'db.example.com'),
      admin.replace('127.0.0.1', 'db.example.com'),
    ],
    ['different hosts', runtime, admin.replace('127.0.0.1', 'localhost')],
    ['different ports', runtime, admin.replace('55433', '55434')],
    [
      'different databases',
      runtime,
      admin.replace('crm_backend_test_1025', 'crm_other_test'),
    ],
    [
      'privileged runtime role',
      runtime.replace('crm_app:crm_app', 'crm:crm'),
      admin,
    ],
    [
      'unexpected admin role',
      runtime,
      admin.replace('crm:crm', 'postgres:postgres'),
    ],
    [
      'wrong protocol',
      runtime.replace('postgresql:', 'https:'),
      admin.replace('postgresql:', 'https:'),
    ],
    ['host override', runtime + '?host=db.example.com', admin],
    ['database override', runtime + '?database=crm', admin],
    ['role override', runtime + '?user=crm', admin],
  ])('rejects %s before connecting', (_label, runtimeUrl, adminUrl) => {
    expect(() => assertIsolatedTestDatabase(runtimeUrl, adminUrl)).toThrow();
  });
});
