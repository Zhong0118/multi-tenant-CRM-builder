"use client";

import type { paths } from "@crm/contracts";
import createClient from "openapi-fetch";

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export const browserApiClient = createClient<paths>({
  baseUrl: apiOrigin,
  credentials: "include",
});
