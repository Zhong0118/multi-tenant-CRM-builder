import "server-only";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";
import { createServerApiClient } from "@/lib/api/server-client";

/**
 * Reads the business objects the current member may open. The API already
 * removes unpublished, archived, no-read and NONE-scope objects, so the
 * navigation renders exactly what the published schema and live member
 * overrides allow.
 *
 * Navigation is supporting furniture: a failure here degrades to an empty
 * business group rather than taking down the whole workspace shell. Page-level
 * access is still enforced server-side on every object route.
 */
export async function requireRuntimeObjects(
  tenantCode: string,
): Promise<RuntimeObjectNavigation[]> {
  const client = await createServerApiClient();
  const { data } = await client.GET("/api/v1/workspaces/{tenantCode}/objects", {
    params: { path: { tenantCode } },
  });

  return (data ?? [])
    .filter((object) => object.canRead)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
    );
}
