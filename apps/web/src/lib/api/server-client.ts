import "server-only";

import type { paths } from "@crm/contracts";
import { headers } from "next/headers";
import createClient from "openapi-fetch";

export async function createServerApiClient() {
  const incomingHeaders = await headers();
  const forwardedHeaders = new Headers();
  forwardHeader(incomingHeaders, forwardedHeaders, "cookie");
  forwardHeader(incomingHeaders, forwardedHeaders, "x-request-id");

  return createClient<paths>({
    baseUrl: process.env.API_ORIGIN ?? "http://localhost:3001",
    headers: forwardedHeaders,
  });
}

function forwardHeader(
  source: Pick<Headers, "get">,
  target: Headers,
  name: "cookie" | "x-request-id",
): void {
  const value = source.get(name);
  if (value) target.set(name, value);
}
