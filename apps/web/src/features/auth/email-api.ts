import { browserApiClient } from "@/lib/api/browser-client";
import { dataOrThrow } from "@/features/objects/object-api";

export type EmailPurpose = "BIND" | "CHANGE" | "REVERIFY";
export type EmailStatus =
  "UNBOUND" | "UNVERIFIED" | "VERIFIED" | "UNDELIVERABLE";
type Challenge = {
  purpose: EmailPurpose;
  email?: string;
  currentPassword?: string;
};

export const emailApi = {
  async challenge(body: Challenge) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/me/email/challenges", { body }),
    );
  },
  async cancel(challengeId: string) {
    return dataOrThrow(
      await browserApiClient.DELETE(
        "/api/v1/me/email/challenges/{challengeId}",
        { params: { path: { challengeId } } },
      ),
    );
  },
  async verify(body: Challenge & { challengeId: string; code: string }) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/me/email/verify", { body }),
    );
  },
  async remove(currentPassword: string) {
    return dataOrThrow(
      await browserApiClient.DELETE("/api/v1/me/email", {
        body: { currentPassword },
      }),
    );
  },
  async device(newDeviceMailEnabled: boolean) {
    return dataOrThrow(
      await browserApiClient.PATCH("/api/v1/me/notification-settings", {
        body: { newDeviceMailEnabled },
      }),
    );
  },
  async forgot(email: string) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/email/forgot-password", {
        body: { email },
      }),
    );
  },
  async reset(body: {
    email: string;
    challengeId: string;
    code: string;
    newPassword: string;
  }) {
    return dataOrThrow(
      await browserApiClient.POST("/api/v1/auth/email/reset-password", {
        body,
      }),
    );
  },
};
