import { AccountShell } from "@/components/layout/account-shell";
import { SettingRow } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { AccountEmail } from "@/features/auth/account-email";
import styles from "./security.module.css";
import { SessionList } from "@/features/auth/session-list";
import { toApiError } from "@/lib/api/api-error";
import { createServerApiClient } from "@/lib/api/server-client";
import { requireUser } from "@/lib/auth/require-user";
import { maskPhone } from "@/features/tenants/mask-phone";

/** "+8618800001002" → "+86 188****1002". */
function formatPhone(phone: string) {
  const masked = maskPhone(phone);
  return phone.startsWith("+86") && masked !== phone ? `+86 ${masked}` : masked;
}

export default async function AccountSecurityPage() {
  const user = await requireUser("/account/security");
  const client = await createServerApiClient();
  const [activeResult, historyResult, settings] = await Promise.all([
    client.GET("/api/v1/me/sessions", {
      params: { query: { kind: "ACTIVE", page: 1, limit: 100 } },
    }),
    client.GET("/api/v1/me/sessions", {
      params: { query: { kind: "HISTORY", page: 1, limit: 10 } },
    }),
    user.mailAvailable && user.emailStatus === "VERIFIED"
      ? client.GET("/api/v1/me/notification-settings")
      : Promise.resolve(null),
  ]);

  if (!activeResult.data || !historyResult.data) {
    const failed = activeResult.data ? historyResult : activeResult;
    const apiError = toApiError(failed.error, failed.response.status);
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <AccountShell
      current="security"
      user={{
        displayName: user.displayName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      }}
    >
      <PageHeader
        title="账号安全"
        description="管理登录方式、验证邮箱，以及登录过这个账号的设备。"
      />
      <SessionList
        initialActive={activeResult.data}
        initialHistory={historyResult.data}
        verification={
          <>
            <SettingRow label="手机号" help="用于登录和找回密码">
              <span className={styles.value}>{formatPhone(user.phone)}</span>
            </SettingRow>
            {/* No key: the row keeps its success notice across the refresh
                that brings the new address. */}
            <AccountEmail
              status={user.emailStatus}
              maskedEmail={user.maskedEmail}
              available={user.mailAvailable}
              newDevice={settings?.data?.newDeviceMailEnabled ?? null}
            />
          </>
        }
      />
    </AccountShell>
  );
}
