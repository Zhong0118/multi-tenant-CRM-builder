import "server-only";

import { redirect } from "next/navigation";

import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";

export async function requireUser(returnTo = "/") {
  const client = await createServerApiClient();
  const { data, error, response } = await client.GET("/api/v1/me");

  if (response.status === 401) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!data) {
    const apiError = toApiError(error, response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return data;
}
