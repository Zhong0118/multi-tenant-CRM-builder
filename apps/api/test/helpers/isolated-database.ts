export function assertIsolatedTestDatabase(
  runtimeValue: string | undefined,
  adminValue: string | undefined,
): void {
  if (!runtimeValue || !adminValue) {
    throw new Error(
      'TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required',
    );
  }
  const runtime = new URL(runtimeValue);
  const admin = new URL(adminValue);
  for (const url of [runtime, admin]) {
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/[a-z0-9_]+$/i.test(url.pathname) ||
      !/(^|_)test(_|$)/i.test(url.pathname.slice(1)) ||
      [...url.searchParams.keys()].some((key) => key !== 'schema')
    ) {
      throw new Error('Refusing non-isolated local test database');
    }
  }
  if (runtime.host !== admin.host || runtime.pathname !== admin.pathname) {
    throw new Error(
      'Test database URLs must use the same host, port and database',
    );
  }
  if (runtime.username !== 'crm_app' || admin.username !== 'crm') {
    throw new Error('Refusing unexpected database roles');
  }
}
