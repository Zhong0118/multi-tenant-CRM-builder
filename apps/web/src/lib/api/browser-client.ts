"use client";

import type { paths } from "@crm/contracts";
import createClient from "openapi-fetch";

import { browserApiOrigin } from "./api-origin";

const apiOrigin = browserApiOrigin();

export const browserApiClient = createClient<paths>({
  baseUrl: apiOrigin,
  credentials: "include",
});
