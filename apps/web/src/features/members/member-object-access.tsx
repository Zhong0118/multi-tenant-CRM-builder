"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@crm/contracts";
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

import { DATA_SCOPE_LABELS } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import styles from "./members.module.css";

type Schemas = components["schemas"];
export type MemberObjectAccessRow = Schemas["MemberObjectAccessResponseDto"];
export type MemberObjectPolicy = Schemas["MemberObjectPolicyResponseDto"];
export type MemberObjectAccessInput = Schemas["MemberObjectAccessDto"];

export interface MemberAccessApi {
  list(tenantCode: string, memberId: string): Promise<MemberObjectAccessRow[]>;
  set(
    tenantCode: string,
    memberId: string,
    objectId: string,
    input: MemberObjectAccessInput,
  ): Promise<MemberObjectAccessRow>;
}

const ACCESS_PATH =
  "/api/v1/workspaces/{tenantCode}/members/{memberId}/object-access" as const;

export const memberAccessApi: MemberAccessApi = {
  async list(tenantCode, memberId) {
    return dataOrThrow(
      await browserApiClient.GET(ACCESS_PATH, {
        params: { path: { tenantCode, memberId } },
      }),
    );
  },
  async set(tenantCode, memberId, objectId, input) {
    return dataOrThrow(
      await browserApiClient.PUT(`${ACCESS_PATH}/{objectId}`, {
        params: { path: { tenantCode, memberId, objectId } },
        body: input,
      }),
    );
  },
};

async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

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
 * Field access is deliberately absent: it stays role-level in the published
 * snapshot, so a member override can only change actions and data scope.
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

  const save = useMutation({
    mutationFn: ({
      objectId,
      input,
    }: {
      objectId: string;
      input: MemberObjectAccessInput;
    }) => api.set(tenantCode, memberId, objectId, input),
    onMutate: () => setError(undefined),
    onSuccess: (updated) => {
      setRows((current) =>
        current.map((row) =>
          row.objectId === updated.objectId ? updated : row,
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["workspace", tenantCode, "members"],
        exact: false,
      });
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
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
      {error ? <Alert type="error" showIcon title={error} /> : null}

      {rows.map((row) => (
        <ObjectAccessPanel
          key={row.objectId}
          row={row}
          memberName={memberName}
          saving={save.isPending && save.variables?.objectId === row.objectId}
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
  onSave,
}: {
  row: MemberObjectAccessRow;
  memberName: string;
  saving: boolean;
  onSave: (input: MemberObjectAccessInput) => void;
}) {
  const [draft, setDraft] = useState<MemberObjectPolicy>(
    () => row.override ?? row.inherited,
  );
  const overriding = row.mode === "OVERRIDE";

  function chooseMode(mode: "INHERIT" | "OVERRIDE") {
    if (mode === "INHERIT") {
      onSave({ mode: "INHERIT" });
      return;
    }
    // Seed the override from what the member effectively has today, so turning
    // it on changes nothing until the administrator decides what to change.
    setDraft(row.override ?? row.inherited);
  }

  const [expanded, setExpanded] = useState(overriding);

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
        <Radio.Group
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
      </header>

      <p className={styles.accessInherited}>
        员工默认：{describePolicy(row.inherited)}
      </p>

      {expanded ? (
        <Form component={false} layout="vertical">
          <div className={styles.accessGrid}>
            <Form.Item label="可以新建记录" htmlFor={`${row.objectId}-create`}>
              <Switch
                id={`${row.objectId}-create`}
                aria-label="可以新建记录"
                checked={draft.canCreate}
                onChange={(canCreate) => setDraft({ ...draft, canCreate })}
              />
            </Form.Item>
            <Form.Item label="可以查看记录" htmlFor={`${row.objectId}-read`}>
              <Switch
                id={`${row.objectId}-read`}
                aria-label="可以查看记录"
                checked={draft.canRead}
                onChange={(canRead) => setDraft({ ...draft, canRead })}
              />
            </Form.Item>
            <Form.Item label="可以修改记录" htmlFor={`${row.objectId}-update`}>
              <Switch
                id={`${row.objectId}-update`}
                aria-label="可以修改记录"
                checked={draft.canUpdate}
                onChange={(canUpdate) => setDraft({ ...draft, canUpdate })}
              />
            </Form.Item>
            <Form.Item label="查看范围" htmlFor={`${row.objectId}-read-scope`}>
              <Select
                id={`${row.objectId}-read-scope`}
                aria-label="查看范围"
                value={draft.readScope}
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
                onChange={(updateScope) => setDraft({ ...draft, updateScope })}
                options={scopeOptions()}
              />
            </Form.Item>
          </div>

          <Space>
            <Button
              type="primary"
              loading={saving}
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
              在该对象上的员工默认权限。本切片不授予员工删除权限。
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
