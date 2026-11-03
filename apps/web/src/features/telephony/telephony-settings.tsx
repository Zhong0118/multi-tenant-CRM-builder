"use client";

import { ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Spin,
  Switch,
  Tabs,
  Tag,
} from "antd";
import { useId, useState } from "react";
import { PageSection, SettingRow, SettingRows } from "@/components/layout/page";
import { objectApi } from "@/features/objects/object-api";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { browserApiOrigin } from "@/lib/api/api-origin";
import {
  telephonyApi,
  type TelephonyApi,
  type TelephonyBinding,
  type TelephonySettingsData,
} from "./telephony-api";
import styles from "./telephony.module.css";

export function TelephonySettings({
  tenantCode,
  tenantId,
  api = telephonyApi,
}: {
  tenantCode: string;
  tenantId?: string;
  api?: TelephonyApi;
}) {
  const client = useQueryClient();
  const key = ["telephony", tenantCode, "settings"];
  const config = useQuery({
    queryKey: key,
    queryFn: () => api.settings(tenantCode),
    staleTime: 0,
    gcTime: 0,
  });
  const [tab, setTab] = useState("connection");
  const [notice, setNotice] = useState<string>();
  const saved = (settings: TelephonySettingsData) =>
    client.setQueryData(key, settings);
  if (config.isPending) return <Spin aria-label="加载电话配置" />;
  if (config.isError)
    return (
      <Alert
        type="error"
        showIcon
        title="电话配置加载失败"
        action={<Button onClick={() => void config.refetch()}>重试</Button>}
      />
    );
  return (
    <div className={styles.surface}>
      {notice ? <Alert type="success" showIcon title={notice} /> : null}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "connection",
            label: "接入配置",
            children: (
              <ConnectionForm
                key={config.data.version}
                tenantCode={tenantCode}
                tenantId={tenantId}
                settings={config.data}
                api={api}
                onSaved={(settings) => {
                  saved(settings);
                  setNotice("接入配置已保存");
                }}
                onReload={() => void config.refetch()}
              />
            ),
          },
          {
            key: "members",
            label: "成员坐席",
            children: <MemberBindings tenantCode={tenantCode} api={api} />,
          },
          {
            key: "fields",
            label: "业务表字段",
            children: (
              <PhoneFields
                key={config.data.version}
                tenantCode={tenantCode}
                settings={config.data}
                api={api}
                onSaved={(settings) => {
                  saved(settings);
                  setNotice("电话字段已保存");
                }}
                onReload={() => void config.refetch()}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function ConnectionForm({
  tenantCode,
  tenantId,
  settings,
  api,
  onSaved,
  onReload,
}: {
  tenantCode: string;
  tenantId?: string;
  settings: TelephonySettingsData;
  api: TelephonyApi;
  onSaved: (settings: TelephonySettingsData) => void;
  onReload: () => void;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [mode, setMode] = useState(settings.mode);
  const [companyId, setCompanyId] = useState(settings.companyId);
  const [appSecret, setAppSecret] = useState("");
  const [callbackToken, setCallbackToken] = useState("");
  const id = useId();
  const save = useMutation({
    mutationFn: () =>
      api.updateSettings(tenantCode, {
        version: settings.version,
        enabled,
        mode,
        companyId,
        ...(appSecret ? { appSecret } : {}),
        ...(callbackToken ? { callbackToken } : {}),
      }),
    onSuccess: onSaved,
    onSettled: () => {
      setAppSecret("");
      setCallbackToken("");
    },
  });
  const runtime = useQuery({
    queryKey: ["telephony", tenantCode, "runtime"],
    queryFn: () => api.runtime(tenantCode),
  });
  // Credentials never enter error rendering, including server-provided messages.
  const saveError = save.isError
    ? toApiError(save.error).code === "CONFIG_VERSION_CONFLICT"
      ? "配置已被更新，请重新加载后再保存"
      : "接入配置保存失败，请检查配置后重试"
    : undefined;
  const callbackUrl = tenantId
    ? `${browserApiOrigin()}/api/v1/telephony/hooks/${encodeURIComponent(tenantId)}`
    : undefined;
  return (
    <div className={styles.stack}>
      {saveError ? (
        <Alert
          type="error"
          showIcon
          title={saveError}
          action={<Button onClick={onReload}>重新加载</Button>}
        />
      ) : null}
      <PageSection
        title="公司接入"
        description="主叫号码取自当前成员的坐席配置，客户号码取自已授权的业务字段"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <SettingRows
            footer={
              <>
                <Button
                  icon={<ReloadOutlined aria-hidden />}
                  onClick={onReload}
                >
                  重新加载
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined aria-hidden />}
                  loading={save.isPending}
                >
                  保存接入配置
                </Button>
              </>
            }
          >
            <SettingRow
              label="电话外呼"
              help="公司开关与成员外呼权限同时生效"
              htmlFor={`${id}-enabled`}
            >
              <Switch
                id={`${id}-enabled`}
                aria-label="启用电话外呼"
                checked={enabled}
                onChange={setEnabled}
                checkedChildren="开启"
                unCheckedChildren="关闭"
              />
            </SettingRow>
            <SettingRow label="接入方式" htmlFor={`${id}-mode`}>
              <select
                id={`${id}-mode`}
                className={styles.select}
                aria-label="接入方式"
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="MOCK">本地模拟</option>
                <option value="KUAIMA">快马通讯</option>
              </select>
              {mode === "KUAIMA" ? (
                <p className={styles.hint}>
                  <Tag color="blue">
                    {runtime.data?.liveEnabled ? "环境已启用" : "待环境启用"}
                  </Tag>
                  真实外呼需完成供应商确认后由管理员启用环境
                </p>
              ) : (
                <p className={styles.hint}>
                  仅演示外呼流程，不会呼叫手机，不计入真实通话统计
                </p>
              )}
            </SettingRow>
            <SettingRow label="企业 ID" htmlFor={`${id}-company`}>
              <Input
                id={`${id}-company`}
                aria-label="企业 ID"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                autoComplete="off"
                maxLength={200}
              />
            </SettingRow>
            <SettingRow
              label="应用密钥"
              htmlFor={`${id}-secret`}
              help={
                settings.hasAppSecret ? "已保存 · 留空保留现有密钥" : "尚未配置"
              }
            >
              <Input.Password
                id={`${id}-secret`}
                aria-label="应用密钥"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                autoComplete="new-password"
                visibilityToggle={false}
                placeholder={
                  settings.hasAppSecret
                    ? "留空保留现有密钥"
                    : "输入供应商应用密钥"
                }
              />
            </SettingRow>
            <SettingRow
              label="回调凭据"
              htmlFor={`${id}-callback`}
              help={
                settings.hasCallbackToken
                  ? "已保存 · 留空保留现有凭据"
                  : "至少 16 个字符"
              }
            >
              <Input.Password
                id={`${id}-callback`}
                aria-label="回调凭据"
                value={callbackToken}
                onChange={(event) => setCallbackToken(event.target.value)}
                autoComplete="new-password"
                visibilityToggle={false}
                minLength={callbackToken ? 16 : undefined}
                placeholder={
                  settings.hasCallbackToken
                    ? "留空保留现有凭据"
                    : "输入独立回调凭据"
                }
              />
            </SettingRow>
            {callbackUrl ? (
              <SettingRow
                label="回调地址"
                htmlFor={`${id}-url`}
                help="Bearer 鉴权方案待供应商确认支持，当前配置不代表真实接入已就绪"
              >
                <Input
                  id={`${id}-url`}
                  aria-label="回调地址"
                  value={callbackUrl}
                  readOnly
                />
              </SettingRow>
            ) : null}
          </SettingRows>
        </form>
      </PageSection>
    </div>
  );
}

function MemberBindings({
  tenantCode,
  api,
}: {
  tenantCode: string;
  api: TelephonyApi;
}) {
  const client = useQueryClient();
  const key = ["telephony", tenantCode, "members"];
  const roster = useQuery({
    queryKey: key,
    queryFn: () => api.members(tenantCode),
  });
  const [notice, setNotice] = useState<string>();
  if (roster.isPending) return <Spin aria-label="加载成员坐席" />;
  if (roster.isError)
    return (
      <Alert
        type="error"
        title="成员坐席加载失败"
        action={<Button onClick={() => void roster.refetch()}>重试</Button>}
      />
    );
  return (
    <div className={styles.stack}>
      <p className={styles.hint}>
        每位成员使用自己的手机接听回拨，坐席开关独立控制外呼权限，管理员也可绑定自己的坐席
      </p>
      {notice ? <Alert type="success" showIcon title={notice} /> : null}
      {!roster.data.members.length ? (
        <Empty description="暂无成员" />
      ) : (
        roster.data.members.map((member) => (
          <BindingForm
            key={`${member.memberId}:${member.version}`}
            member={member}
            tenantCode={tenantCode}
            api={api}
            onSaved={(updated) => {
              client.setQueryData<Awaited<ReturnType<TelephonyApi["members"]>>>(
                key,
                (current) =>
                  current
                    ? {
                        members: current.members.map((existing) =>
                          existing.memberId === updated.memberId
                            ? updated
                            : existing,
                        ),
                      }
                    : current,
              );
              setNotice(`${updated.displayName}的坐席已保存`);
              void client.invalidateQueries({
                queryKey: ["telephony", tenantCode, "runtime"],
              });
            }}
            onReload={() => void roster.refetch()}
          />
        ))
      )}
    </div>
  );
}
function BindingForm({
  tenantCode,
  member,
  api,
  onSaved,
  onReload,
}: {
  tenantCode: string;
  member: TelephonyBinding;
  api: TelephonyApi;
  onSaved: (binding: TelephonyBinding) => void;
  onReload: () => void;
}) {
  const [enabled, setEnabled] = useState(member.enabled);
  const [phone, setPhone] = useState(member.phone);
  const [seatId, setSeatId] = useState(member.seatId);
  const id = useId();
  const disabled = member.status !== "ACTIVE";
  const save = useMutation({
    mutationFn: () =>
      api.updateMember(tenantCode, member.memberId, {
        version: member.version,
        enabled,
        phone,
        seatId,
      }),
    onSuccess: onSaved,
  });
  return (
    <section className={styles.panel} aria-label={`${member.displayName}坐席`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className={styles.panelHead}>
          <h3>
            {member.displayName}
            {disabled ? <Tag>成员已停用</Tag> : null}
          </h3>
          <Switch
            aria-label={`${member.displayName}外呼权限`}
            checked={enabled}
            disabled={disabled || save.isPending}
            checkedChildren="允许外呼"
            unCheckedChildren="外呼关闭"
            onChange={setEnabled}
          />
        </div>
        <div className={styles.bindingFields}>
          <label className={styles.control} htmlFor={`${id}-seat`}>
            坐席号
            <Input
              id={`${id}-seat`}
              aria-label="坐席号"
              value={seatId}
              disabled={disabled}
              required={enabled}
              onChange={(event) => setSeatId(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={styles.control} htmlFor={`${id}-phone`}>
            接听手机号
            <Input
              id={`${id}-phone`}
              aria-label="接听手机号"
              type="tel"
              value={phone}
              disabled={disabled}
              required={enabled}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="off"
              placeholder="中国大陆手机号或 +86"
            />
          </label>
          <Button
            htmlType="submit"
            loading={save.isPending}
            disabled={disabled}
          >
            保存坐席
          </Button>
        </div>
        {save.isError ? (
          <Alert
            type="error"
            title={toApiError(save.error).message}
            action={<Button onClick={onReload}>重新加载成员</Button>}
          />
        ) : null}
      </form>
    </section>
  );
}

function PhoneFields({
  tenantCode,
  settings,
  api,
  onSaved,
  onReload,
}: {
  tenantCode: string;
  settings: TelephonySettingsData;
  api: TelephonyApi;
  onSaved: (settings: TelephonySettingsData) => void;
  onReload: () => void;
}) {
  const tables = useQuery({
    queryKey: ["telephony", tenantCode, "published-phone-fields"],
    queryFn: async () => {
      const objects = await objectApi.listAccessible(tenantCode);
      return Promise.all(
        objects.map((object) =>
          objectApi.runtimeSchema(tenantCode, object.code),
        ),
      );
    },
  });
  const [notice, setNotice] = useState<string>();
  const published = new Map(
    (tables.data ?? []).map((schema) => [
      schema.object.code,
      {
        name: schema.object.name,
        keys: new Set(
          schema.fields
            .filter((field) => field.type === "PHONE" || field.type === "TEXT")
            .map((field) => field.fieldKey),
        ),
      },
    ]),
  );
  const stale = settings.phoneFields.flatMap((table) => {
    const current = published.get(table.objectCode);
    const fieldKeys = table.fieldKeys.filter((key) => !current?.keys.has(key));
    return !current || fieldKeys.length
      ? [{ objectCode: table.objectCode, name: current?.name, fieldKeys }]
      : [];
  });
  const cleanup = useMutation({
    mutationFn: () =>
      api.updateSettings(tenantCode, {
        version: settings.version,
        phoneFields: settings.phoneFields.flatMap((table) => {
          const current = published.get(table.objectCode);
          return current
            ? [
                {
                  ...table,
                  fieldKeys: table.fieldKeys.filter((key) =>
                    current.keys.has(key),
                  ),
                },
              ]
            : [];
        }),
      }),
    onSuccess: onSaved,
  });
  if (tables.isPending || tables.isFetching)
    return <Spin aria-label="加载已发布业务表" />;
  if (tables.isError)
    return (
      <Alert
        type="error"
        title="业务表字段加载失败"
        action={<Button onClick={() => void tables.refetch()}>重试</Button>}
      />
    );
  return (
    <div className={styles.stack}>
      <p className={styles.hint}>
        选择已发布业务表中的电话或文本字段，成员只能拨打自己有权读取的号码
      </p>
      {notice ? <Alert type="success" title={notice} showIcon /> : null}
      {stale.length ? (
        <section className={styles.panel} aria-label="失效外呼配置">
          <h3>保存电话字段前，请先清理以下失效配置</h3>
          <p className={styles.hint}>
            仅移除下面列出的业务表和字段，其他有效配置保持不变
          </p>
          <ul>
            {stale.map((table) => (
              <li key={table.objectCode}>
                {table.name
                  ? `${table.name}（${table.objectCode}）`
                  : table.objectCode}
                ：{table.fieldKeys.join("、") || "无电话字段"}（
                {table.name ? "字段已失效" : "业务表当前不可用"}）
              </li>
            ))}
          </ul>
          {cleanup.isError ? (
            <Alert
              type="error"
              title="清理失败，请重新加载配置后重试"
              action={<Button onClick={onReload}>重新加载配置</Button>}
            />
          ) : null}
          <Button loading={cleanup.isPending} onClick={() => cleanup.mutate()}>
            清理失效外呼配置
          </Button>
        </section>
      ) : null}
      {!tables.data.length ? (
        <Empty description="暂无已发布业务表，请先发布业务表" />
      ) : (
        tables.data.map((schema) => (
          <TablePhoneFields
            key={`${schema.object.code}:${settings.version}`}
            schema={schema}
            blocked={stale.length > 0 || cleanup.isPending}
            settings={settings}
            tenantCode={tenantCode}
            api={api}
            onSaved={(updated) => {
              onSaved(updated);
              setNotice(`${schema.object.name}的电话字段已保存`);
            }}
            onReload={onReload}
          />
        ))
      )}
    </div>
  );
}
function TablePhoneFields({
  schema,
  blocked,
  settings,
  tenantCode,
  api,
  onSaved,
  onReload,
}: {
  schema: RuntimeObjectSchema;
  blocked: boolean;
  settings: TelephonySettingsData;
  tenantCode: string;
  api: TelephonyApi;
  onSaved: (settings: TelephonySettingsData) => void;
  onReload: () => void;
}) {
  const fields = schema.fields.filter(
    (field) => field.type === "PHONE" || field.type === "TEXT",
  );
  const eligibleKeys = new Set(fields.map((field) => field.fieldKey));
  const initial = (
    settings.phoneFields.find(
      (table) => table.objectCode === schema.object.code,
    )?.fieldKeys ?? []
  ).filter((key) => eligibleKeys.has(key));
  const [selected, setSelected] = useState(initial);
  const save = useMutation({
    mutationFn: () =>
      api.updateSettings(tenantCode, {
        version: settings.version,
        phoneFields: [
          ...settings.phoneFields.filter(
            (table) => table.objectCode !== schema.object.code,
          ),
          {
            objectCode: schema.object.code,
            fieldKeys: selected.filter((key) => eligibleKeys.has(key)),
          },
        ],
      }),
    onSuccess: onSaved,
  });
  return (
    <section
      className={styles.panel}
      aria-label={`${schema.object.name}电话字段`}
    >
      <div className={styles.panelHead}>
        <h3>{schema.object.name}</h3>
        <Tag>已发布 v{schema.publication.number}</Tag>
      </div>
      <div className={styles.fieldChoices}>
        {fields.length ? (
          fields.map((field) => (
            <Checkbox
              key={field.fieldKey}
              checked={selected.includes(field.fieldKey)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, field.fieldKey]
                    : current.filter((key) => key !== field.fieldKey),
                )
              }
            >
              {field.label}
            </Checkbox>
          ))
        ) : (
          <p className={styles.hint}>没有可用的电话或文本字段</p>
        )}
      </div>
      {save.isError ? (
        <Alert
          type="error"
          title="电话字段保存失败，请重新加载后重试"
          action={<Button onClick={onReload}>重新加载配置</Button>}
        />
      ) : null}
      <div className={styles.actions}>
        <Button
          disabled={blocked}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          保存电话字段
        </Button>
      </div>
    </section>
  );
}
