"use client";

import type { components } from "@crm/contracts";

import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

type Schemas = components["schemas"];
type Accepted = Schemas["AcceptedResponseDto"];
type Authenticated = Schemas["AuthenticatedResponseDto"];
export type WorkspaceSummary = Schemas["WorkspaceSummaryResponseDto"];

export interface AuthApi {
  requestRegisterCode(input: {
    phone: string;
    deviceKey: string;
  }): Promise<Accepted>;
  register(input: Schemas["RegisterDto"]): Promise<Authenticated>;
  login(input: Schemas["LoginDto"]): Promise<Authenticated>;
  requestPasswordResetCode(input: {
    phone: string;
    deviceKey: string;
  }): Promise<Accepted>;
  resetPassword(input: Schemas["ResetPasswordDto"]): Promise<Accepted>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
}

async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

export const authApi: AuthApi = {
  async requestRegisterCode({ phone, deviceKey }) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/verification-challenges", {
        body: { phone, deviceKey, purpose: "REGISTER" },
      }),
    );
  },
  async register(body) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/register", { body }),
    );
  },
  async login(body) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/login", { body }),
    );
  },
  async requestPasswordResetCode({ phone, deviceKey }) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/forgot-password", {
        body: { phone, deviceKey },
      }),
    );
  },
  async resetPassword(body) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/reset-password", { body }),
    );
  },
  async listWorkspaces() {
    return dataOrThrow(await browserApiClient.GET("/api/v1/me/workspaces"));
  },
};
