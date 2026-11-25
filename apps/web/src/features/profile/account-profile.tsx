"use client";

import { Button, Input } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { components } from "@crm/contracts";
import { ProfileAvatar } from "@/components/identity/profile-avatar";
import { PageSection, SettingRow } from "@/components/layout/page";
import { StatusTag } from "@/components/workbench/status-tag";
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
  accessibleLabel,
  placeholder,
  initial,
  maxLength,
  required = false,
  save,
}: {
  accessibleLabel: string;
  placeholder?: string;
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
      <Input
        aria-label={accessibleLabel}
        placeholder={placeholder}
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
      {(busy || value.trim() !== saved) && (
        <Button
          type="primary"
          htmlType="submit"
          aria-label={"保存" + accessibleLabel}
          loading={busy}
          disabled={required && !value.trim()}
        >
          保存
        </Button>
      )}
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
      <PageSection
        title="账号"
        description="姓名和头像会显示在你加入的所有公司。"
      >
        <div className={styles.group}>
          <SettingRow label="头像" help="JPG、PNG 或 WebP，不超过 2 MB">
            <div className={styles.avatarRow}>
              <ProfileAvatar name={displayName} avatarUrl={image} size={48} />
              <AvatarEditor
                avatarUrl={image}
                onChange={(url) => {
                  setImage(url);
                  router.refresh();
                }}
              />
            </div>
          </SettingRow>
          <SettingRow label="账号姓名">
            <EditableField
              accessibleLabel="账号姓名"
              initial={name}
              required
              maxLength={100}
              save={async (value) => {
                await api.name(value);
                setName(value);
                router.refresh();
              }}
            />
          </SettingRow>
        </div>
      </PageSection>
      <PageSection
        title="所在公司"
        description="职位只在对应公司内显示；公司内显示名和工号由公司管理员设置。"
      >
        {!memberships.length && <p className={styles.empty}>还没有加入公司</p>}
        <div className={styles.companies}>
          {memberships.map((m) => (
            <section
              key={m.memberId}
              className={styles.group}
              aria-label={m.tenantName}
            >
              <header className={styles.companyHead}>
                <h3>{m.tenantName}</h3>
                <StatusTag>
                  {m.role === "TENANT_ADMIN" ? "公司管理员" : "员工"}
                </StatusTag>
              </header>
              <SettingRow label="公司内显示名">
                <span className={styles.value}>
                  {m.memberDisplayName ?? "使用账号姓名"}
                </span>
              </SettingRow>
              <SettingRow label="工号">
                <span className={styles.value}>{m.employeeNo || "—"}</span>
              </SettingRow>
              <SettingRow label="职位">
                <EditableField
                  placeholder="例如：销售经理"
                  accessibleLabel={m.tenantName + "职位"}
                  initial={m.jobTitle ?? ""}
                  maxLength={50}
                  save={async (value) => {
                    await api.title(m.memberId, value);
                    router.refresh();
                  }}
                />
              </SettingRow>
            </section>
          ))}
        </div>
      </PageSection>
    </div>
  );
}
