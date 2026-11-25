"use client";

import { Button, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { components } from "@crm/contracts";
import { ProfileAvatar } from "@/components/identity/profile-avatar";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import { dataOrThrow } from "@/features/objects/object-api";
import { AvatarEditor } from "./avatar-editor";
import styles from "./profile.module.css";

const profileApi = {
  async name(displayName: string) {
    return dataOrThrow(
      await browserApiClient.PATCH("/api/v1/me/profile", {
        body: { displayName },
      }),
    );
  },
  async title(memberId: string, jobTitle: string) {
    return dataOrThrow(
      await browserApiClient.PATCH(
        "/api/v1/me/memberships/{memberId}/job-title",
        { params: { path: { memberId } }, body: { jobTitle } },
      ),
    );
  },
};
type Membership = components["schemas"]["AccountMembershipDto"];

function EditableField({
  label,
  accessibleLabel = label,
  initial,
  maxLength,
  required = false,
  save,
}: {
  label: string;
  accessibleLabel?: string;
  initial: string;
  maxLength: number;
  required?: boolean;
  save: (v: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  async function submit() {
    const next = value.trim();
    if (busy || next === saved || (required && !next)) return;
    setBusy(true);
    setStatus("");
    try {
      await save(next);
      setValue(next);
      setSaved(next);
      setError(false);
      setStatus("已保存");
    } catch (e) {
      const failure = toApiError(e);
      setError(true);
      setStatus(Object.values(failure.fieldErrors)[0]?.[0] ?? failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.field}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        {label}
        <Input
          aria-label={accessibleLabel}
          value={value}
          maxLength={maxLength}
          disabled={busy}
          status={error ? "error" : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setStatus("");
            setError(false);
          }}
        />
      </label>
      <Button
        htmlType="submit"
        aria-label={"保存" + accessibleLabel}
        loading={busy}
        disabled={value.trim() === saved || (required && !value.trim())}
      >
        保存
      </Button>
      {status && (
        <span role="status" data-error={error}>
          {status}
        </span>
      )}
    </form>
  );
}

export function AccountProfile({
  name,
  avatarUrl,
  memberships,
  api = profileApi,
}: {
  name: string;
  avatarUrl: string | null;
  memberships: Membership[];
  api?: {
    name: (value: string) => Promise<unknown>;
    title: (member: string, value: string) => Promise<unknown>;
  };
}) {
  const router = useRouter();
  const [displayName, setName] = useState(name);
  const [image, setImage] = useState(avatarUrl);
  return (
    <div className={styles.profile}>
      <section className={styles.card} aria-labelledby="account-identity">
        <h2 id="account-identity">账号身份</h2>
        <div className={styles.identity}>
          <ProfileAvatar name={displayName} avatarUrl={image} size={64} />
          <div className={styles.identityText}>
            <strong>{displayName}</strong>
            <p>已应用于各公司</p>
          </div>
          <AvatarEditor
            avatarUrl={image}
            onChange={(url) => {
              setImage(url);
              router.refresh();
            }}
          />
        </div>
        <EditableField
          label="账号姓名"
          initial={name}
          required
          maxLength={100}
          save={async (value) => {
            await api.name(value);
            setName(value);
            router.refresh();
          }}
        />
      </section>
      <section aria-labelledby="account-companies">
        <h2 id="account-companies">我所在的公司</h2>
        {!memberships.length && <p>尚未加入公司</p>}
        {memberships.map((m) => (
          <article key={m.memberId} className={styles.company}>
            <header>
              <h3>{m.tenantName}</h3>
              <span>{m.role === "TENANT_ADMIN" ? "公司管理员" : "员工"}</span>
            </header>
            <dl>
              <div>
                <dt>公司内显示名</dt>
                <dd>
                  {m.memberDisplayName
                    ? m.memberDisplayName + " · 由公司管理员设置"
                    : "使用账号姓名"}
                </dd>
              </div>
              <div>
                <dt>工号</dt>
                <dd>{m.employeeNo || "—"}</dd>
              </div>
            </dl>
            <EditableField
              label="职位"
              accessibleLabel={m.tenantName + "职位"}
              initial={m.jobTitle ?? ""}
              maxLength={50}
              save={async (value) => {
                await api.title(m.memberId, value);
                router.refresh();
              }}
            />
          </article>
        ))}
      </section>
    </div>
  );
}
