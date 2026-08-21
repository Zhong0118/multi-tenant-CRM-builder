"use client";

import type { paths } from "@crm/contracts";
import createClient from "openapi-fetch";

import { resolveBrowserApiOrigin } from "./api-origin";

const configuredApiOrigin =
  process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
const apiOrigin = resolveBrowserApiOrigin(
  configuredApiOrigin,
  typeof window === "undefined" ? undefined : window.location.hostname,
);

export const browserApiClient = createClient<paths>({
  baseUrl: apiOrigin,
  credentials: "include",
});
