import "server-only";

import { headers } from "next/headers";

/**
 * Where to send someone the API no longer recognises. A browser that still
 * carries a session cookie was signed out from elsewhere (a password change,
 * a reset, or a revoked device), and the login page says so.
 */
export async function loginPath(returnTo: string) {
  const cookie = (await headers()).get("cookie") ?? "";
  const params = new URLSearchParams({ returnTo });
  if (/(?:^|;\s*)crm_session=[^;]+/.test(cookie))
    params.set("reason", "signed-out");
  return `/login?${params}`;
}
