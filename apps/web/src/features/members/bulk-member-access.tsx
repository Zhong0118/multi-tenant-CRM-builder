"use client";

import { Alert, Button, Drawer, Form, Select, Space, Switch } from "antd";
import type { components } from "@crm/contracts";
import { useRef, useState } from "react";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import { DATA_SCOPE_LABELS } from "@/features/objects/object-types";
import {
  memberAccessApi,
  type MemberObjectAccessRow,
  type MemberObjectPolicy,
} from "./member-access-api";
import type { TenantMember } from "./member-table";
import styles from "./members.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

export const FIELD_ACCESS_LABELS = {
  EDIT: "可编辑",
  READ_ONLY: "只读",
  HIDDEN: "隐藏",
};
type FieldChange =
  components["schemas"]["MemberFieldAccessChangeDto"]["access"];
type SelectedMember = Pick<
  TenantMember,
  "id" | "displayName" | "role" | "status"
>;
export type MemberBatchAccessInput =
  components["schemas"]["BulkMemberAccessDto"];
export interface MemberBatchAccessApi {
  list(tenantCode: string, memberId: string): Promise<MemberObjectAccessRow[]>;
  set(
    tenantCode: string,
    objectId: string,
    input: MemberBatchAccessInput,
  ): Promise<components["schemas"]["BulkMemberAccessResponseDto"]>;
}
export const memberBatchAccessApi: MemberBatchAccessApi = {
  list: memberAccessApi.list,
  async set(tenantCode, objectId, input) {
    const result = await browserApiClient.PATCH(
      "/api/v1/workspaces/{tenantCode}/objects/{objectId}/member-access",
      {
        params: { path: { tenantCode, objectId } },
        body: input,
      },
    );
    if (result.data !== undefined) return result.data;
    throw toApiError(result.error, result.response.status);
  },
};

export function BulkMemberAccess({
  tenantCode,
  selected,
  onChanged,
  api = memberBatchAccessApi,
  initialRows,
  initialObjectId,
  buttonLabel,
  disabled = false,
}: {
  tenantCode: string;
  selected: SelectedMember[];
  onChanged: () => void | Promise<void>;
  api?: MemberBatchAccessApi;
  initialRows?: MemberObjectAccessRow[];
  initialObjectId?: string;
  buttonLabel?: string;
  disabled?: boolean;
}) {
  const eligible = selected.filter(
    (member) => member.role === "EMPLOYEE" && member.status === "ACTIVE",
  );
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<SelectedMember[]>([]);
  const [objects, setObjects] = useState<MemberObjectAccessRow[]>([]);
  const [objectId, setObjectId] = useState<string>();
  const [objectMode, setObjectMode] = useState<"KEEP" | "INHERIT" | "OVERRIDE">(
    "KEEP",
  );
  const [policy, setPolicy] = useState<MemberObjectPolicy>();
  const [fields, setFields] = useState<Record<string, FieldChange>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const running = useRef(false);
  const row = objects.find((object) => object.objectId === objectId);
  const hasChanges = objectMode !== "KEEP" || Object.keys(fields).length > 0;

  function chooseObject(nextId: string, nextObjects = objects) {
    setObjectId(nextId);
    setObjectMode("KEEP");
    setFields({});
    setPolicy(
      nextObjects.find((object) => object.objectId === nextId)?.inherited,
    );
    setError(undefined);
  }
  async function start() {
    if (!eligible.length || eligible.length > 100 || running.current) return;
    const nextTargets = [...eligible];
    setTargets(nextTargets);
    setObjects([]);
    setObjectId(undefined);
    setObjectMode("KEEP");
    setFields({});
    setError(undefined);
    setNotice(undefined);
    setLoading(true);
    setOpen(true);
    try {
      const next =
        initialRows ?? (await api.list(tenantCode, nextTargets[0].id));
      setObjects(next);
      if (initialObjectId) chooseObject(initialObjectId, next);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    if (!row || !hasChanges || running.current) return;
    running.current = true;
    setSaving(true);
    setError(undefined);
    const input: MemberBatchAccessInput = {
      memberIds: targets.map((member) => member.id),
    };
    if (objectMode === "INHERIT") input.objectAccess = { mode: "INHERIT" };
    if (objectMode === "OVERRIDE" && policy)
      input.objectAccess = {
        mode: "OVERRIDE",
        canCreate: policy.canCreate,
        canRead: policy.canRead,
        canUpdate: policy.canUpdate,
        readScope: policy.readScope,
        updateScope: policy.updateScope,
      };
    if (Object.keys(fields).length)
      input.fields = Object.entries(fields).map(([fieldId, access]) => ({
        fieldId,
        access,
      }));
    try {
      const result = await api.set(tenantCode, row.objectId, input);
      setNotice(`已更新 ${result.updated} 位员工的访问权限，立即生效`);
      setOpen(false);
      await onChanged();
    } catch (caught) {
      const failure = toApiError(caught);
      setError(`${failure.message}（请求编号：${failure.requestId}）`);
    } finally {
      running.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <Button
        title="仅设置当前页所选的在职员工，管理员及已停用成员不参与"
        disabled={
          disabled || !eligible.length || eligible.length > 100 || loading
        }
        onClick={() => void start()}
      >
        {buttonLabel ?? `批量设置访问权限（${eligible.length} 人）`}
      </Button>
      {notice && (
        <Alert
          type="success"
          showIcon
          title={notice}
          closable
          onClose={() => setNotice(undefined)}
        />
      )}
      {eligible.length > 100 && <span>每次最多设置 100 位员工</span>}
      <Drawer
        title="设置访问权限"
        open={open}
        size={OVERLAY_SIZE.wide}
        destroyOnHidden
        className={styles.accessDrawer}
        closable={!saving && !loading}
        keyboard={!saving && !loading}
        mask={{ closable: !saving && !loading }}
        onClose={() => {
          if (!running.current && !loading) setOpen(false);
        }}
        footer={
          <Space wrap>
            <Button disabled={saving || loading} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!row || !hasChanges || saving || loading}
              onClick={() => void save()}
            >
              保存并应用到 {targets.length} 人
            </Button>
          </Space>
        }
      >
        <div className={styles.accessList}>
          <p>
            将应用到 {targets.length} 位有效员工：
            {targets
              .map((member) => member.displayName ?? "未设置姓名")
              .join("、")}
          </p>
          <Alert
            type="info"
            showIcon
            title="只改你选择的表和列，其余保留各员工现有权限"
            description="这里保存的是成员例外，立即生效；员工默认在业务表设计器中修改并发布。列权限不能超出表的查看与修改范围；隐藏标题列会使员工无法访问整张业务表。"
          />
          {error && <Alert type="error" showIcon title={error} />}
          <Form layout="vertical" component={false}>
            <Form.Item label="业务表">
              <Select
                aria-label="业务表"
                placeholder="选择已发布业务表"
                value={objectId}
                loading={loading}
                disabled={saving || loading}
                options={objects.map((object) => ({
                  value: object.objectId,
                  label: object.objectName,
                }))}
                onChange={(id) => chooseObject(id)}
                style={{ width: "100%" }}
              />
            </Form.Item>
            {!loading && !error && !objects.length && (
              <Alert type="info" title="暂无已发布的业务表" />
            )}
            {row && (
              <div key={row.objectId} className={styles.accessEditor}>
                <Form.Item label="表权限">
                  <Select
                    aria-label="表权限"
                    value={objectMode}
                    disabled={saving}
                    onChange={setObjectMode}
                    options={[
                      { value: "KEEP", label: "不修改" },
                      { value: "INHERIT", label: "恢复为员工默认" },
                      { value: "OVERRIDE", label: "设置成员例外" },
                    ]}
                  />
                </Form.Item>
                <p className={styles.drawerNote}>
                  员工默认：{row.inherited.canCreate ? "可新建" : "不可新建"} ·{" "}
                  {row.inherited.canRead ? "可查看" : "不可查看"} ·{" "}
                  {row.inherited.canUpdate ? "可修改" : "不可修改"} · 查看
                  {DATA_SCOPE_LABELS[row.inherited.readScope]} · 修改
                  {DATA_SCOPE_LABELS[row.inherited.updateScope]}
                </p>
                {objectMode === "OVERRIDE" && policy && (
                  <div className={styles.accessGrid}>
                    {(
                      [
                        ["canCreate", "可以新建记录"],
                        ["canRead", "可以查看记录"],
                        ["canUpdate", "可以修改记录"],
                      ] as const
                    ).map(([key, label]) => (
                      <Form.Item key={key} label={label}>
                        <Switch
                          aria-label={label}
                          checked={policy[key]}
                          disabled={saving}
                          onChange={(checked) =>
                            setPolicy({ ...policy, [key]: checked })
                          }
                        />
                      </Form.Item>
                    ))}
                    {(
                      [
                        ["readScope", "查看范围"],
                        ["updateScope", "修改范围"],
                      ] as const
                    ).map(([key, label]) => (
                      <Form.Item key={key} label={label}>
                        <Select
                          aria-label={label}
                          value={policy[key]}
                          disabled={saving}
                          onChange={(value) =>
                            setPolicy({ ...policy, [key]: value })
                          }
                          options={(["ALL", "OWN", "NONE"] as const).map(
                            (value) => ({
                              value,
                              label: DATA_SCOPE_LABELS[value],
                            }),
                          )}
                        />
                      </Form.Item>
                    ))}
                  </div>
                )}
                <h3 className={styles.drawerHeading}>列权限</h3>
                {(row.fields ?? []).map((field) => (
                  <div className={styles.fieldAccessRow} key={field.fieldId}>
                    <div className={styles.fieldAccessName}>
                      <strong>{field.label}</strong>
                      <span className={styles.secondary}>
                        员工默认：{FIELD_ACCESS_LABELS[field.inherited]}
                        {field.isSystem ? " · 系统列，不可设置例外" : ""}
                      </span>
                    </div>
                    {field.isSystem ? (
                      <span className={styles.secondary}>只读</span>
                    ) : (
                      <Select
                        aria-label={`${field.label}权限`}
                        value={fields[field.fieldId] ?? "KEEP"}
                        disabled={saving}
                        options={[
                          { value: "KEEP", label: "不修改" },
                          { value: "INHERIT", label: "恢复为员工默认" },
                          ...Object.entries(FIELD_ACCESS_LABELS).map(
                            ([value, label]) => ({ value, label }),
                          ),
                        ]}
                        onChange={(value: FieldChange | "KEEP") =>
                          setFields((current) => {
                            const next = { ...current };
                            if (value === "KEEP") delete next[field.fieldId];
                            else next[field.fieldId] = value;
                            return next;
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Form>
        </div>
      </Drawer>
    </>
  );
}
