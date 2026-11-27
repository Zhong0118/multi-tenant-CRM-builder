"use client";

import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tooltip,
} from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
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
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { objectApi } from "@/features/objects/object-api";
import { toApiError } from "@/lib/api/api-error";

import {
  formatPhone,
  telephonyApi,
  type TelephonyBinding,
  type TelephonySettings,
  type TelephonySettingsInput,
} from "./telephony-api";
import styles from "./telephony.module.css";

/** Where the company's line stands, in two or three words. */
export function lineStatus(settings: TelephonySettings): {
  label: string;
  tone: StatusTone;
} {
  if (!settings.enabled) return { label: "未开启", tone: "neutral" };
  if (settings.mode === "MOCK") return { label: "模拟线路", tone: "info" };
  if (
    !settings.companyId ||
    !settings.hasAppSecret ||
    !settings.hasCallbackToken
  )
    return { label: "配置未完成", tone: "warning" };
  if (!settings.liveEnabled)
    return { label: "等待服务器开通", tone: "warning" };
  return { label: "快马回拨", tone: "success" };
}

const PHONE_TYPES = new Set(["PHONE", "TEXT"]);

/**
 * Company outbound calling: the line, which phone fields may be dialled, and
 * who has a seat. Every change saves on its own, like system settings.
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
  const { modal } = App.useApp();
  const key = ["telephony-settings", tenantCode, memberId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => telephonyApi.settings(tenantCode),
  });
  const members = useQuery({
    queryKey: ["telephony-members", tenantCode, memberId],
    queryFn: () => telephonyApi.members(tenantCode),
  });
  const objects = useQuery({
    queryKey: ["objects-accessible", tenantCode, memberId],
    queryFn: () => objectApi.listAccessible(tenantCode),
  });
  const schemas = useQueries({
    queries: (objects.data ?? []).map((object) => ({
      queryKey: ["object-runtime-schema", tenantCode, object.code, memberId],
      queryFn: () => objectApi.runtimeSchema(tenantCode, object.code),
    })),
  });
  const [error, setError] = useState<string>();
  const [account, setAccount] = useState<{
    companyId: string;
    appSecret: string;
  }>();
  const [callbackUrl, setCallbackUrl] = useState<string>();
  const [editing, setEditing] = useState<TelephonyBinding & { open: true }>();

  const fail = (cause: unknown) => {
    const apiError = toApiError(cause);
    setError(
      apiError.status === 409
        ? "设置刚被其他管理员修改，已刷新为最新内容，请再试一次。"
        : apiError.message,
    );
    if (apiError.status === 409) void settings.refetch();
  };
  const save = useMutation({
    mutationFn: (input: Omit<TelephonySettingsInput, "version">) =>
      telephonyApi.updateSettings(tenantCode, {
        ...input,
        version: settings.data?.version ?? 0,
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result, input) => {
      client.setQueryData(key, result);
      void client.invalidateQueries({
        queryKey: ["telephony-runtime", tenantCode],
      });
      if (input.companyId !== undefined) setAccount(undefined);
      toast.success("已保存");
    },
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: () => telephonyApi.rotateCallbackToken(tenantCode),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(key, result.settings);
      setCallbackUrl(result.callbackUrl);
    },
    onError: fail,
  });
  const saveMember = useMutation({
    mutationFn: (binding: TelephonyBinding) =>
      telephonyApi.updateMember(tenantCode, binding.memberId, {
        enabled: binding.enabled,
        seatId: binding.seatId.trim(),
        phone: binding.phone.trim(),
        version: binding.version,
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(
        ["telephony-members", tenantCode, memberId],
        (current: { members: TelephonyBinding[] } | undefined) =>
          current && {
            members: current.members.map((entry) =>
              entry.memberId === result.memberId ? result : entry,
            ),
          },
      );
      setEditing(undefined);
      toast.success("已保存");
    },
    onError: (cause) => {
      fail(cause);
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

  const status = lineStatus(state);
  const kuaima = state.mode === "KUAIMA";
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
  const seated = bindings.filter((entry) => entry.enabled).length;

  return (
    <Page width="settings">
      <PageHeader
        title="电话外呼"
        status={<StatusTag tone={status.tone}>{status.label}</StatusTag>}
      />
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
          <PageSection title="线路">
            <div className={styles.group}>
              <SettingRow label="电话外呼">
                <div className={styles.switchRow}>
                  <Switch
                    aria-label="开启电话外呼"
                    checked={state.enabled}
                    loading={
                      save.isPending && save.variables?.enabled !== undefined
                    }
                    onChange={(enabled) => save.mutate({ enabled })}
                  />
                </div>
              </SettingRow>
              <SettingRow label="线路">
                <div className={styles.value}>
                  <Segmented
                    size="small"
                    aria-label="线路"
                    value={state.mode}
                    onChange={(mode) =>
                      save.mutate({ mode: mode as "MOCK" | "KUAIMA" })
                    }
                    options={[
                      {
                        value: "MOCK",
                        label: "模拟",
                        disabled: !state.mockAllowed,
                      },
                      { value: "KUAIMA", label: "快马回拨" },
                    ]}
                  />
                </div>
              </SettingRow>
              {kuaima ? (
                <>
                  <SettingRow label="企业账号">
                    {account ? (
                      <form
                        className={styles.inlineForm}
                        onSubmit={(event) => {
                          event.preventDefault();
                          save.mutate({
                            companyId: account.companyId,
                            appSecret: account.appSecret || undefined,
                          });
                        }}
                      >
                        <Form layout="vertical" component={false}>
                          <Form.Item label="企业 ID" htmlFor="kuaima-company">
                            <Input
                              id="kuaima-company"
                              autoFocus
                              autoComplete="off"
                              value={account.companyId}
                              onChange={(event) =>
                                setAccount({
                                  ...account,
                                  companyId: event.target.value,
                                })
                              }
                            />
                          </Form.Item>
                          <Form.Item label="企业密钥" htmlFor="kuaima-secret">
                            <Input.Password
                              id="kuaima-secret"
                              autoComplete="new-password"
                              placeholder={
                                state.hasAppSecret ? "不修改请留空" : undefined
                              }
                              value={account.appSecret}
                              onChange={(event) =>
                                setAccount({
                                  ...account,
                                  appSecret: event.target.value,
                                })
                              }
                            />
                          </Form.Item>
                        </Form>
                        <div className={styles.inlineActions}>
                          <Button
                            disabled={save.isPending}
                            onClick={() => setAccount(undefined)}
                          >
                            取消
                          </Button>
                          <Button
                            type="primary"
                            htmlType="submit"
                            loading={save.isPending}
                            disabled={
                              !account.companyId.trim() ||
                              (!state.hasAppSecret && !account.appSecret.trim())
                            }
                          >
                            保存
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className={styles.value}>
                        <span className={styles.text}>
                          {state.companyId ? (
                            <>
                              {state.companyId}
                              <span className={styles.muted}>
                                {state.hasAppSecret
                                  ? " · 密钥已保存"
                                  : " · 缺少密钥"}
                              </span>
                            </>
                          ) : (
                            <span className={styles.muted}>未填写</span>
                          )}
                        </span>
                        <Button
                          size="small"
                          onClick={() =>
                            setAccount({
                              companyId: state.companyId,
                              appSecret: "",
                            })
                          }
                        >
                          {state.companyId ? "修改" : "填写"}
                        </Button>
                      </div>
                    )}
                  </SettingRow>
                  <SettingRow label="回调地址">
                    <div className={styles.value}>
                      <span
                        className={
                          state.hasCallbackToken ? styles.text : styles.muted
                        }
                      >
                        {state.hasCallbackToken ? "已生成" : "未生成"}
                      </span>
                      <Button
                        size="small"
                        loading={rotate.isPending}
                        onClick={() =>
                          state.hasCallbackToken
                            ? void modal.confirm({
                                title: "重新生成回调地址？",
                                content:
                                  "旧地址立即失效，需把新地址发给快马客服重新配置。",
                                okText: "重新生成",
                                cancelText: "取消",
                                onOk: () => rotate.mutateAsync(),
                              })
                            : rotate.mutate()
                        }
                      >
                        {state.hasCallbackToken ? "重新生成" : "生成"}
                      </Button>
                    </div>
                  </SettingRow>
                  <SettingRow label="真实外呼">
                    <div className={styles.value}>
                      <span className={styles.text}>
                        {state.liveEnabled ? "服务器已开通" : "服务器未开通"}
                        <Tooltip title="由部署配置 TELEPHONY_LIVE_ENABLED 控制，未开通时不会拨出真实电话。">
                          <InfoCircleOutlined className={styles.hint} />
                        </Tooltip>
                      </span>
                    </div>
                  </SettingRow>
                </>
              ) : (
                <SettingRow label="说明">
                  <span className={styles.muted}>
                    模拟线路不拨真实电话，直接记为已接通 30 秒。
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
                            save.mutate({
                              phoneFields: phoneFieldsWith(
                                object.code,
                                fieldKeys,
                              ),
                            })
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
            members.data ? (
              <span className={styles.count}>
                已开启 {seated} / {bindings.length}
              </span>
            ) : null
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
                      onClick={() => setEditing({ ...binding, open: true })}
                    >
                      <span className={styles.memberName}>
                        {binding.displayName}
                        {binding.status !== "ACTIVE" ? (
                          <StatusTag>已停用</StatusTag>
                        ) : null}
                      </span>
                      <span className={styles.muted}>
                        {binding.seatId && binding.phone
                          ? `坐席 ${binding.seatId} · ${formatPhone(binding.phone)}`
                          : "未设置坐席"}
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
                        enabled && !(binding.seatId && binding.phone)
                          ? setEditing({ ...binding, enabled, open: true })
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
        title={editing ? `${editing.displayName}的坐席` : undefined}
        open={Boolean(editing)}
        width={400}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveMember.isPending}
        okButtonProps={{
          disabled: Boolean(
            editing?.enabled &&
            !(editing.seatId.trim() && editing.phone.trim()),
          ),
        }}
        onOk={() => editing && saveMember.mutate(editing)}
        onCancel={() => setEditing(undefined)}
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical" className={styles.modalForm}>
            <Form.Item
              label="坐席号"
              htmlFor="seat-id"
              help="快马后台「坐席管理」里的坐席 ID"
            >
              <Input
                id="seat-id"
                autoFocus
                autoComplete="off"
                value={editing.seatId}
                onChange={(event) =>
                  setEditing({ ...editing, seatId: event.target.value })
                }
              />
            </Form.Item>
            <Form.Item
              label="接听手机"
              htmlFor="seat-phone"
              help="拨号时线路先回拨这个手机"
            >
              <Input
                id="seat-phone"
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

      <Modal
        title="回调地址"
        open={Boolean(callbackUrl)}
        width={480}
        footer={
          <Button type="primary" onClick={() => setCallbackUrl(undefined)}>
            我已复制
          </Button>
        }
        onCancel={() => setCallbackUrl(undefined)}
        maskClosable={false}
      >
        <p className={styles.modalNote}>
          只显示这一次。复制后发给快马客服，配置为话单推送地址。
        </p>
        <Input.TextArea
          aria-label="回调地址"
          readOnly
          autoSize
          value={callbackUrl}
          onFocus={(event) => event.target.select()}
          className={styles.url}
        />
        <Button
          className={styles.copy}
          size="small"
          onClick={() =>
            callbackUrl &&
            void navigator.clipboard
              .writeText(callbackUrl)
              .then(() => toast.success("已复制"))
          }
        >
          复制
        </Button>
      </Modal>
    </Page>
  );
}
