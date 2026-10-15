"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";

import { StatusTag } from "@/components/workbench/status-tag";
import { DATA_SCOPE_LABELS } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import { BulkMemberAccess, FIELD_ACCESS_LABELS } from "./bulk-member-access";
import styles from "./members.module.css";

export type {
  MemberAccessApi,
  MemberObjectAccessRow,
  MemberObjectPolicy,
  MemberObjectAccessInput,
} from "./member-access-api";
export { memberAccessApi } from "./member-access-api";
import {
  memberAccessApi,
  type MemberAccessApi,
  type MemberObjectAccessRow,
  type MemberObjectPolicy,
  type MemberObjectAccessInput,
} from "./member-access-api";

export interface MemberObjectAccessProps {
  tenantCode: string;
  memberId: string;
  memberName: string;
  initialRows: MemberObjectAccessRow[];
  api?: MemberAccessApi;
}

/**
 * Per-object access for one employee. An object either follows the published
 * employee default or carries a member override that replaces it entirely —
 * there is no partial override, because a half-applied policy could not be
 * reasoned about.
 *
 * Field overrides are edited separately through the shared bulk editor.
 */
export function MemberObjectAccess({
  tenantCode,
  memberId,
  memberName,
  initialRows,
  api = memberAccessApi,
}: MemberObjectAccessProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const save = useMutation({
    mutationFn: ({
      objectId,
      input,
    }: {
      objectId: string;
      input: MemberObjectAccessInput;
    }) => api.set(tenantCode, memberId, objectId, input),
    onMutate: () => {
      setError(undefined);
      setNotice(undefined);
    },
    onSuccess: (updated) => {
      setRows((current) =>
        current.map((row) =>
          row.objectId === updated.objectId ? updated : row,
        ),
      );
      setNotice(
        updated.mode === "INHERIT"
          ? `${updated.objectName}已恢复为员工默认权限`
          : `${updated.objectName}的成员覆盖已保存`,
      );
      void queryClient.invalidateQueries({
        queryKey: ["workspace", tenantCode, "members"],
        exact: false,
      });
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setNotice(undefined);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  if (rows.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        title="公司还没有已发布的业务对象。"
        description="先在设置中配置并发布业务对象，再回来调整成员访问权限。"
      />
    );
  }

  return (
    <div className={styles.accessList}>
      <Alert
        type="info"
        showIcon
        title="成员覆盖保存后立即生效，无需重新发布对象；员工默认权限需要在对象设计器中发布后生效。"
      />
      {notice ? (
        <Alert
          type="success"
          showIcon
          closable
          title={notice}
          description="保存已立即生效，无需重新发布对象。"
          onClose={() => setNotice(undefined)}
        />
      ) : null}

      {error ? <Alert type="error" showIcon title={error} /> : null}

      {rows.map((row) => (
        <ObjectAccessPanel
          key={row.objectId}
          row={row}
          memberName={memberName}
          accessEditor={
            <BulkMemberAccess
              tenantCode={tenantCode}
              selected={[
                {
                  id: memberId,
                  displayName: memberName,
                  role: "EMPLOYEE",
                  status: "ACTIVE",
                },
              ]}
              initialRows={rows}
              initialObjectId={row.objectId}
              disabled={save.isPending}
              buttonLabel="设置表和列权限"
              onChanged={async () => {
                setNotice("成员表和列权限已保存并立即生效");
                try {
                  setRows(await api.list(tenantCode, memberId));
                } catch (caught) {
                  setError(
                    `权限已保存，刷新失败：${toApiError(caught).message}`,
                  );
                }
                void queryClient.invalidateQueries({
                  queryKey: ["workspace", tenantCode, "members"],
                });
              }}
            />
          }
          saving={save.isPending}
          onSave={(input) => save.mutate({ objectId: row.objectId, input })}
        />
      ))}
    </div>
  );
}

function ObjectAccessPanel({
  row,
  memberName,
  saving,
  accessEditor,
  onSave,
}: {
  row: MemberObjectAccessRow;
  memberName: string;
  saving: boolean;
  accessEditor: React.ReactNode;
  onSave: (input: MemberObjectAccessInput) => void;
}) {
  const [draft, setDraft] = useState<MemberObjectPolicy>(
    () => row.override ?? row.effective,
  );
  const overriding = row.mode === "OVERRIDE";

  function chooseMode(mode: "INHERIT" | "OVERRIDE") {
    if (mode === "INHERIT") {
      onSave({ mode: "INHERIT" });
      return;
    }
    // Keep the local policy when switching modes, including after a failed save.
  }

  const [expanded, setExpanded] = useState(overriding);
  const [savedRow, setSavedRow] = useState(row);
  if (savedRow !== row) {
    setSavedRow(row);
    setExpanded(row.mode === "OVERRIDE");
    setDraft(row.override ?? row.effective);
  }

  return (
    <section
      role="group"
      aria-label={row.objectName}
      className={styles.accessPanel}
    >
      <header className={styles.accessPanelHeader}>
        <div>
          <strong>{row.objectName}</strong>
          <span className={styles.accessCode}>{row.objectCode}</span>
        </div>
        <div className={styles.accessModeControl}>
          <StatusTag tone={overriding ? "warning" : "info"}>
            {overriding ? "已生效：成员覆盖" : "已生效：跟随员工默认"}
          </StatusTag>
          <Radio.Group
            disabled={saving}
            value={expanded ? "OVERRIDE" : "INHERIT"}
            onChange={(event) => {
              const mode = event.target.value as "INHERIT" | "OVERRIDE";
              setExpanded(mode === "OVERRIDE");
              chooseMode(mode);
            }}
            options={[
              { label: "使用员工默认", value: "INHERIT" },
              { label: "成员覆盖", value: "OVERRIDE" },
            ]}
          />
        </div>
      </header>

      <p className={styles.accessEffective}>
        当前有效权限：{describePolicy(row.effective)}
      </p>
      <p className={styles.accessInherited}>
        员工默认：{describePolicy(row.inherited)}
      </p>

      <div className={styles.fieldAccessList}>
        {(row.fields ?? []).map((field) => (
          <p key={field.fieldId}>
            {field.label} · 当前：{FIELD_ACCESS_LABELS[field.effective]} ·
            默认：{FIELD_ACCESS_LABELS[field.inherited]}
            {field.isSystem
              ? " · 系统列，不可覆盖"
              : field.override
                ? " · 成员覆盖"
                : " · 跟随默认"}
          </p>
        ))}
        {accessEditor}
      </div>

      {expanded ? (
        <Form component={false} layout="vertical">
          <p className={styles.accessInherited}>
            正在编辑成员覆盖；保存后立即生效，无需发布。
          </p>
          <div className={styles.accessGrid}>
            <Form.Item label="可以新建记录" htmlFor={`${row.objectId}-create`}>
              <Switch
                id={`${row.objectId}-create`}
                aria-label="可以新建记录"
                checked={draft.canCreate}
                disabled={saving}
                onChange={(canCreate) => setDraft({ ...draft, canCreate })}
              />
            </Form.Item>
            <Form.Item label="可以查看记录" htmlFor={`${row.objectId}-read`}>
              <Switch
                id={`${row.objectId}-read`}
                aria-label="可以查看记录"
                checked={draft.canRead}
                disabled={saving}
                onChange={(canRead) => setDraft({ ...draft, canRead })}
              />
            </Form.Item>
            <Form.Item label="可以修改记录" htmlFor={`${row.objectId}-update`}>
              <Switch
                id={`${row.objectId}-update`}
                aria-label="可以修改记录"
                checked={draft.canUpdate}
                disabled={saving}
                onChange={(canUpdate) => setDraft({ ...draft, canUpdate })}
              />
            </Form.Item>
            <Form.Item label="查看范围" htmlFor={`${row.objectId}-read-scope`}>
              <Select
                id={`${row.objectId}-read-scope`}
                aria-label="查看范围"
                value={draft.readScope}
                disabled={saving}
                onChange={(readScope) => setDraft({ ...draft, readScope })}
                options={scopeOptions()}
              />
            </Form.Item>
            <Form.Item
              label="修改范围"
              htmlFor={`${row.objectId}-update-scope`}
            >
              <Select
                id={`${row.objectId}-update-scope`}
                aria-label="修改范围"
                value={draft.updateScope}
                disabled={saving}
                onChange={(updateScope) => setDraft({ ...draft, updateScope })}
                options={scopeOptions()}
              />
            </Form.Item>
          </div>

          <Space>
            <Button
              type="primary"
              loading={saving}
              disabled={saving}
              onClick={() =>
                onSave({
                  mode: "OVERRIDE",
                  canCreate: draft.canCreate,
                  canRead: draft.canRead,
                  canUpdate: draft.canUpdate,
                  readScope: draft.readScope,
                  updateScope: draft.updateScope,
                })
              }
            >
              保存覆盖
            </Button>
            <Typography.Text type="secondary">
              覆盖会整条替换 {memberName}{" "}
              在该对象上的员工默认权限；保存后立即生效。列权限可通过“设置表和列权限”单独调整，不授予员工删除权限。
            </Typography.Text>
          </Space>
        </Form>
      ) : null}
    </section>
  );
}

function describePolicy(policy: MemberObjectPolicy): string {
  const actions = [
    policy.canCreate ? "新建" : null,
    policy.canRead ? "查看" : null,
    policy.canUpdate ? "修改" : null,
  ].filter(Boolean);
  const allowed = actions.length > 0 ? actions.join(" / ") : "无操作权限";
  return `${allowed} · 查看${DATA_SCOPE_LABELS[policy.readScope]} · 修改${
    DATA_SCOPE_LABELS[policy.updateScope]
  }`;
}

function scopeOptions() {
  return (["ALL", "OWN", "NONE"] as const).map((scope) => ({
    value: scope,
    label: DATA_SCOPE_LABELS[scope],
  }));
}
