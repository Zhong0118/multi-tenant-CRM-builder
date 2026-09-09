"use client";
import { browserApiOrigin } from "./api-origin";
import { toApiError } from "./api-error";
export async function relationRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${browserApiOrigin()}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw toApiError(result, response.status);
  return result as T;
}
