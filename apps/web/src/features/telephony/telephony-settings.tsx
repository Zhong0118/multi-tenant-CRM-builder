"use client";

import {
  Alert,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Skeleton,
  Switch,
  Tooltip,
} from "antd";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import { Page, PageSection, SettingRow } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/components/feedback/use-toast";
import { StatePanel } from "@/components/workbench/state-panel";
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { objectApi } from "@/features/objects/object-api";
import { toApiError } from "@/lib/api/api-error";

import {
  dialable,
  formatPhone,
  telephonyApi,
  type TelephonyBinding,
  type TelephonySettings,
  type TelephonySettingsInput,
} from "./telephony-api";
import styles from "./telephony.module.css";

/** Where the company's calling stands, in two or three words. */
export function serviceStatus(
  settings: Pick<TelephonySettings, "plan" | "lineReady" | "usage">,
): { label: string; tone: StatusTone } {
  if (!settings.plan) return { label: "未开通", tone: "neutral" };
  if (!settings.lineReady) return { label: "平台线路未就绪", tone: "warning" };
  if (settings.usage.usedMinutes >= settings.usage.allowance)
    return { label: "本月分钟已用完", tone: "danger" };
  return { label: "已开通", tone: "success" };
}

/** A member's seat in a few words: whether the line made one and the phone it rings. */
function seatText(binding: TelephonyBinding) {
  if (binding.seatStatus === "FAILED")
    return `建坐席失败：${binding.seatError ?? "快马没有说明原因"}`;
  if (binding.seatStatus === "READY")
    return `已建坐席 · ${formatPhone(binding.phone)}`;
  return binding.phone
    ? `未建坐席 · ${formatPhone(binding.phone)}`
    : "未建坐席";
}

const PHONE_TYPES = new Set(["PHONE", "TEXT"]);

/**
 * Company outbound calling: the plan the platform assigned and this month's
 * use, which phone fields may be dialled, and who may call. The platform runs
 * the line and creates the seats; nothing here shows money or the account.
 */
export function TelephonySettingsPage({
  tenantCode,
  memberId,
}: {
  tenantCode: string;
  memberId: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const key = ["telephony-settings", tenantCode, memberId];
  const membersKey = ["telephony-members", tenantCode, memberId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => telephonyApi.settings(tenantCode),
  });
  const open = Boolean(settings.data?.plan);
  const members = useQuery({
    queryKey: membersKey,
    queryFn: () => telephonyApi.members(tenantCode),
    enabled: open,
  });
  const objects = useQuery({
    queryKey: ["objects-accessible", tenantCode, memberId],
    queryFn: () => objectApi.listAccessible(tenantCode),
    enabled: open,
  });
  const schemas = useQueries({
    queries: (objects.data ?? []).map((object) => ({
      queryKey: ["object-runtime-schema", tenantCode, object.code, memberId],
      queryFn: () => objectApi.runtimeSchema(tenantCode, object.code),
    })),
  });
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<TelephonyBinding>();

  const fail = (cause: unknown) => {
    const apiError = toApiError(cause);
    // A full seat list is a 409 too, but its message says what to do.
    setError(
      apiError.status === 409 && !apiError.fieldErrors.telephony
        ? "设置刚被其他管理员修改，已刷新为最新内容，请再试一次。"
        : apiError.message,
    );
    void settings.refetch();
  };
  const save = useMutation({
    mutationFn: (phoneFields: TelephonySettingsInput["phoneFields"]) =>
      telephonyApi.updateSettings(tenantCode, {
        version: settings.data?.version ?? 0,
        phoneFields,
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(key, result);
      void client.invalidateQueries({
        queryKey: ["telephony-runtime", tenantCode],
      });
      toast.success("已保存");
    },
    onError: fail,
  });
  const saveMember = useMutation({
    mutationFn: (binding: TelephonyBinding) =>
      telephonyApi.updateMember(tenantCode, binding.memberId, {
        version: binding.version,
        enabled: binding.enabled,
        phone: binding.phone.trim(),
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(
        membersKey,
        (current: { members: TelephonyBinding[] } | undefined) =>
          current && {
            members: current.members.map((entry) =>
              entry.memberId === result.memberId ? result : entry,
            ),
          },
      );
      // The seat count lives on the settings.
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({
        queryKey: ["telephony-runtime", tenantCode],
      });
      setEditing(undefined);
      toast.success("已保存");
    },
    onError: (cause) => {
      fail(cause);
      // A refused seat is saved with the supplier's reason.
      void members.refetch();
    },
  });

  const state = settings.data;
  if (settings.isError)
    return (
      <Page width="settings">
        <PageHeader title="电话外呼" />
        <LoadError
          error={settings.error}
          retry={() => void settings.refetch()}
        />
      </Page>
    );
  if (!state)
    return (
      <Page width="settings">
        <PageHeader title="电话外呼" />
        <Skeleton active />
      </Page>
    );

  const status = serviceStatus(state);
  const header = (
    <PageHeader
      title="电话外呼"
      status={<StatusTag tone={status.tone}>{status.label}</StatusTag>}
    />
  );
  if (!state.plan)
    return (
      <Page width="settings">
        {header}
        <StatePanel
          title="电话外呼未开通"
          description="需要平台管理员为公司开通通话套餐。开通后可以在这里给成员开外呼。"
        />
      </Page>
    );

  const plan = state.plan;
  const usage = state.usage;
  const percent = usage.allowance
    ? Math.min(100, Math.round((usage.usedMinutes / usage.allowance) * 100))
    : 100;
  const saved = new Map(
    state.phoneFields.map((entry) => [entry.objectCode, entry.fieldKeys]),
  );
  const phoneObjects = (objects.data ?? []).flatMap((object, index) => {
    const schema = schemas[index]?.data;
    if (!schema) return [];
    const fields = schema.fields
      .filter((field) => PHONE_TYPES.has(field.type))
      .sort((a, b) =>
        a.type === b.type
          ? a.sortOrder - b.sortOrder
          : a.type === "PHONE"
            ? -1
            : 1,
      );
    return fields.length
      ? [{ code: object.code, name: object.name, fields }]
      : [];
  });
  /** The whole list with one table's fields replaced, minus fields that no longer exist. */
  const phoneFieldsWith = (objectCode: string, fieldKeys: string[]) =>
    phoneObjects
      .map((object) => ({
        objectCode: object.code,
        fieldKeys:
          object.code === objectCode
            ? fieldKeys
            : (saved.get(object.code) ?? []).filter((fieldKey) =>
                object.fields.some((field) => field.fieldKey === fieldKey),
              ),
      }))
      .filter((entry) => entry.fieldKeys.length);
  const bindings = members.data?.members ?? [];

  return (
    <Page width="settings">
      {header}
      {error ? (
        <Alert
          className={styles.alert}
          type="error"
          showIcon
          closable
          title={error}
          onClose={() => setError(undefined)}
        />
      ) : null}
      <div className={styles.grid}>
        <div className={styles.column}>
          <PageSection title="套餐和用量">
            <div className={styles.group}>
              <SettingRow label="套餐">
                <span className={styles.text}>{plan.name}</span>
              </SettingRow>
              <SettingRow label="本月分钟">
                <div className={styles.usage}>
                  <span className={styles.text}>
                    {`${usage.usedMinutes} / ${usage.allowance} 分钟`}
                  </span>
                  <Progress
                    percent={percent}
                    size="small"
                    showInfo={false}
                    status={
                      usage.usedMinutes >= usage.allowance
                        ? "exception"
                        : "normal"
                    }
                  />
                </div>
              </SettingRow>
              <SettingRow label="坐席">
                <span className={styles.text}>
                  {`已开 ${usage.seatsEnabled} / ${plan.seats}`}
                </span>
              </SettingRow>
              {state.lineReady ? null : (
                <SettingRow label="线路">
                  <span className={styles.muted}>
                    员工暂时不能拨号，请联系平台管理员。
                  </span>
                </SettingRow>
              )}
            </div>
          </PageSection>

          <PageSection title="可拨打的号码">
            <div className={styles.group}>
              {objects.isError ? (
                <LoadError
                  error={objects.error}
                  retry={() => void objects.refetch()}
                />
              ) : objects.isPending || schemas.some((q) => q.isPending) ? (
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              ) : phoneObjects.length ? (
                phoneObjects.map((object) => {
                  const keys = saved.get(object.code) ?? [];
                  const current = keys.filter((fieldKey) =>
                    object.fields.some((field) => field.fieldKey === fieldKey),
                  );
                  const stale = keys.length - current.length;
                  return (
                    <SettingRow key={object.code} label={object.name}>
                      <div className={styles.fieldSelect}>
                        <Select
                          mode="multiple"
                          size="small"
                          aria-label={`${object.name}可拨打的字段`}
                          placeholder="不允许拨打"
                          value={current}
                          disabled={save.isPending}
                          onChange={(fieldKeys: string[]) =>
                            save.mutate(phoneFieldsWith(object.code, fieldKeys))
                          }
                          options={object.fields.map((field) => ({
                            value: field.fieldKey,
                            label: field.label,
                          }))}
                        />
                        {stale ? (
                          <Tooltip title="字段已删除或改了类型，下次保存时移除。">
                            <span>
                              <StatusTag tone="warning">
                                {stale} 个失效
                              </StatusTag>
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                    </SettingRow>
                  );
                })
              ) : (
                <p className={styles.empty}>还没有带电话或文本字段的业务表。</p>
              )}
            </div>
          </PageSection>
        </div>

        <PageSection
          title="成员坐席"
          extra={
            <span className={styles.count}>
              {`已开 ${usage.seatsEnabled} / ${plan.seats}`}
            </span>
          }
        >
          <div className={styles.group}>
            {members.isError ? (
              <LoadError
                error={members.error}
                retry={() => void members.refetch()}
              />
            ) : !members.data ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : (
              <ul className={styles.members}>
                {bindings.map((binding) => (
                  <li key={binding.memberId} className={styles.member}>
                    <button
                      type="button"
                      className={styles.memberMain}
                      onClick={() => setEditing(binding)}
                    >
                      <span className={styles.memberName}>
                        {binding.displayName}
                        {binding.status !== "ACTIVE" ? (
                          <StatusTag>已停用</StatusTag>
                        ) : null}
                      </span>
                      <span
                        className={
                          binding.seatStatus === "FAILED"
                            ? styles.failed
                            : styles.muted
                        }
                      >
                        {seatText(binding)}
                      </span>
                    </button>
                    <Switch
                      size="small"
                      aria-label={`${binding.displayName}外呼`}
                      checked={binding.enabled}
                      loading={
                        saveMember.isPending &&
                        saveMember.variables?.memberId === binding.memberId
                      }
                      onChange={(enabled) =>
                        enabled && !dialable(binding.phone)
                          ? setEditing({ ...binding, enabled })
                          : saveMember.mutate({ ...binding, enabled })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PageSection>
      </div>

      <Modal
        title={editing ? `${editing.displayName}的外呼` : undefined}
        open={Boolean(editing)}
        width={400}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveMember.isPending}
        okButtonProps={{
          disabled: Boolean(
            editing?.enabled && !dialable(editing.phone.trim()),
          ),
        }}
        onOk={() => editing && saveMember.mutate(editing)}
        onCancel={() => setEditing(undefined)}
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical" className={styles.modalForm}>
            <Form.Item
              label="接听手机"
              htmlFor="seat-phone"
              help="拨号时线路先回拨这个手机。保存时自动在线路上建坐席。"
            >
              <Input
                id="seat-phone"
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                maxLength={11}
                value={editing.phone}
                onChange={(event) =>
                  setEditing({ ...editing, phone: event.target.value })
                }
              />
            </Form.Item>
            <div className={styles.modalSwitch}>
              <span>允许外呼</span>
              <Switch
                size="small"
                aria-label="允许外呼"
                checked={editing.enabled}
                onChange={(enabled) => setEditing({ ...editing, enabled })}
              />
            </div>
          </Form>
        ) : null}
      </Modal>
    </Page>
  );
}
