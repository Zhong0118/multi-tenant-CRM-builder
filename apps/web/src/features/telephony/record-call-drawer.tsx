"use client";

import { PhoneOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Drawer, Empty, Spin } from "antd";
import Link from "next/link";
import { useRef, useState } from "react";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { recordApi } from "@/features/records/record-api";
import { recordFields } from "@/features/records/record-access";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import { CallStatus, callRecordHref } from "./call-history";
import {
  telephonyApi,
  type TelephonyApi,
  type TelephonyCall,
} from "./telephony-api";
import styles from "./telephony.module.css";

const SETUP_REASONS: Record<string, string> = {
  DISABLED: "公司尚未启用电话外呼，请联系管理员完成配置",
  MEMBER_NOT_CONFIGURED:
    "你的外呼坐席尚未配置，请联系管理员绑定接听手机号和坐席",
  MOCK_FORBIDDEN: "当前环境不支持模拟外呼，请联系管理员检查接入方式",
  LIVE_DISABLED: "真实外呼待环境启用，当前无法拨打",
  PROVIDER_NOT_CONFIGURED:
    "公司接入配置尚未完成，请联系管理员检查企业 ID 和凭据",
  ENCRYPTION_UNAVAILABLE: "外呼服务暂不可用，请联系管理员检查服务配置",
};
const TERMINAL = new Set<TelephonyCall["status"]>([
  "CONNECTED",
  "NOT_CONNECTED",
  "ENDED",
  "FAILED",
]);

/** A record-level entry also covers group-readable phones absent from query columns. */
export function RecordCallAction({
  tenantCode,
  schema,
  record,
  currentMemberName,
}: {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  record: RecordSummary;
  currentMemberName?: string;
}) {
  const [open, setOpen] = useState(false);
  const identity = `${tenantCode}:${schema.object.code}:${record.id}`;
  const trigger = useRef<{
    element: HTMLElement;
    href: string;
    identity: string;
  } | null>(null);
  if (
    !recordFields(schema, record).some(
      (field) =>
        (field.type === "PHONE" || field.type === "TEXT") &&
        typeof record.values[field.fieldKey] === "string",
    )
  )
    return null;
  return (
    <>
      <Button
        type="text"
        size="small"
        className={styles.entry}
        icon={<PhoneOutlined aria-hidden />}
        aria-label={`拨打 ${record.title}`}
        title="电话外呼"
        onClick={(event) => {
          event.stopPropagation();
          trigger.current = {
            element: event.currentTarget,
            href: window.location.href,
            identity,
          };
          setOpen(true);
        }}
      />
      {open ? (
        <RecordCallDrawer
          key={`${tenantCode}:${schema.object.code}:${record.id}`}
          tenantCode={tenantCode}
          objectCode={schema.object.code}
          recordId={record.id}
          currentMemberName={currentMemberName}
          onClose={(restoreFocus = true) => {
            setOpen(false);
            const source = trigger.current;
            if (
              restoreFocus &&
              source?.element.isConnected &&
              source.href === window.location.href &&
              source.identity === identity
            )
              source.element.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </>
  );
}

export function RecordCallDrawer({
  tenantCode,
  objectCode,
  recordId,
  currentMemberName = "当前登录成员",
  onClose,
  api = telephonyApi,
}: {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  currentMemberName?: string;
  onClose: (restoreFocus?: boolean) => void;
  api?: TelephonyApi;
}) {
  const client = useQueryClient();
  const context = useQuery({
    queryKey: ["telephony", tenantCode, "dial-context", objectCode, recordId],
    queryFn: async () => {
      const [runtime, record] = await Promise.all([
        api.runtime(tenantCode, { objectCode, recordId }),
        recordApi.detail(tenantCode, objectCode, recordId),
      ]);
      return { runtime, record };
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState("");
  const [confirmation, setConfirmation] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<TelephonyCall>();
  const [callId, setCallId] = useState<string>();
  const [attempt, setAttempt] = useState<{
    requestId: string;
    fieldKey: string;
  }>();
  const submitting = useRef(false);
  const data =
    !context.isFetching && !context.isError ? context.data : undefined;
  const fields =
    data?.runtime.fields.filter(
      (field) =>
        (!data.record.fieldAccess ||
          (Object.hasOwn(data.record.fieldAccess, field.fieldKey) &&
            data.record.fieldAccess[field.fieldKey] !== "HIDDEN")) &&
        Object.hasOwn(data.record.values, field.fieldKey) &&
        typeof data.record.values[field.fieldKey] === "string",
    ) ?? [];
  const fieldKey = fields.some((field) => field.fieldKey === selected)
    ? selected
    : fields[0]?.fieldKey;
  const phone = fieldKey ? data?.record.values[fieldKey] : undefined;
  const reviewKey =
    data && fieldKey
      ? JSON.stringify([
          data.runtime.mode,
          data.runtime.callerPhone,
          fieldKey,
          phone,
        ])
      : undefined;
  const confirmed = Boolean(reviewKey && confirmation === reviewKey);
  const submit = useMutation({
    mutationFn: (target: { requestId: string; fieldKey: string }) =>
      api.createCall(tenantCode, { ...target, objectCode, recordId }),
    retry: false,
    onSuccess: (call) => {
      setResult(call);
      setCallId(call.id);
      setError(undefined);
      void client.invalidateQueries({
        queryKey: ["telephony", tenantCode, "calls"],
      });
    },
    onError: (caught) => {
      const parsed = toApiError(caught);
      setError(
        parsed.requestId === "req_unknown"
          ? "请求结果暂未收到，重试会核对同一次请求，不会创建另一通电话"
          : parsed.message,
      );
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.call(tenantCode, callId!),
    onMutate: () => {
      setResult(undefined);
      setError(undefined);
    },
    onSuccess: (call) => {
      setResult(call);
      void client.invalidateQueries({
        queryKey: ["telephony", tenantCode, "calls"],
      });
    },
    onError: (caught) => setError(toApiError(caught).message),
  });
  const dial = () => {
    if (submitting.current || callId) return;
    if (!attempt && (!fieldKey || !confirmed || !data?.runtime.available))
      return;
    const target = attempt ?? {
      requestId: crypto.randomUUID(),
      fieldKey: fieldKey!,
    };
    submitting.current = true;
    setAttempt(target);
    setError(undefined);
    submit.mutate(target);
  };
  const href = result ? callRecordHref(tenantCode, result) : null;
  return (
    <Drawer
      open={open}
      title="电话外呼"
      size={OVERLAY_SIZE.narrow}
      onClose={() => {
        setOpen(false);
      }}
      afterOpenChange={(visible) => {
        if (!visible) onClose();
      }}
      focusable={{ focusTriggerAfterClose: false }}
      forceRender
      destroyOnHidden
      className={styles.surface}
    >
      <div className={styles.stack}>
        {error ? <Alert type="error" showIcon title={error} /> : null}
        {callId ? (
          <>
            {refresh.isPending ? (
              <Spin aria-label="刷新通话结果" />
            ) : result ? (
              <section className={styles.panel} aria-label="通话结果">
                <div className={styles.panelHead}>
                  <h2>
                    <CallStatus call={result} />
                  </h2>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>主叫</dt>
                    <dd>{result.callerPhone}</dd>
                  </div>
                  <div>
                    <dt>被叫</dt>
                    <dd>{result.calleePhone ?? "被叫不可见"}</dd>
                  </div>
                  {result.recordTitle ? (
                    <div>
                      <dt>业务记录</dt>
                      <dd>{result.recordTitle}</dd>
                    </div>
                  ) : null}
                  {result.durationSeconds !== null ? (
                    <div>
                      <dt>通话时长</dt>
                      <dd>{result.durationSeconds} 秒</dd>
                    </div>
                  ) : null}
                </dl>
                {result.mode === "MOCK" ? (
                  <p className={styles.hint}>
                    本次为本地模拟，不会呼叫手机，不计入真实通话统计
                  </p>
                ) : null}
                {result.status === "UNKNOWN" ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="请先核实本次通话，不要再次拨打"
                    description="提交结果尚不确定，请联系管理员核实并刷新结果"
                  />
                ) : null}
                {result.status === "ACCEPTED" ||
                result.status === "REQUESTED" ? (
                  <p className={styles.hint}>
                    请求已保存或受理，尚未确认接通，请刷新查看最终结果
                  </p>
                ) : null}
                {href && result.recordingUrl ? (
                  <audio
                    controls
                    preload="none"
                    src={result.recordingUrl}
                    aria-label="通话录音"
                  />
                ) : null}
              </section>
            ) : null}
            <div className={styles.actions}>
              <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                刷新结果
              </Button>
              {href ? (
                <Link href={href} onClick={() => onClose(false)}>
                  返回记录继续跟进
                </Link>
              ) : null}
              {result && TERMINAL.has(result.status) ? (
                <Button
                  onClick={() => {
                    setCallId(undefined);
                    setResult(undefined);
                    setAttempt(undefined);
                    setConfirmation(undefined);
                    setError(undefined);
                    void context.refetch();
                  }}
                >
                  再次拨打
                </Button>
              ) : null}
            </div>
          </>
        ) : attempt ? (
          <>
            <p className={styles.hint}>
              本次请求的拨打目标已锁定，重试只核对同一次请求，不会改拨其他号码
            </p>
            <label className={styles.control}>
              拨打字段
              <select
                className={styles.select}
                aria-label="拨打字段"
                value={attempt.fieldKey}
                disabled
              >
                <option value={attempt.fieldKey}>本次请求的电话字段</option>
              </select>
            </label>
            <Button
              type="primary"
              icon={<PhoneOutlined aria-hidden />}
              loading={submit.isPending}
              disabled={submit.isPending}
              onClick={dial}
            >
              重试本次请求
            </Button>
          </>
        ) : context.isError ? (
          <Alert
            type="error"
            title="无法读取当前拨打信息"
            description={toApiError(context.error).message}
            action={
              <Button onClick={() => void context.refetch()}>重新加载</Button>
            }
          />
        ) : !data ? (
          <Spin aria-label="加载拨打信息" />
        ) : (
          <>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>{data.record.title}</h2>
                <span>
                  {data.runtime.mode === "MOCK" ? "本地模拟" : "手机回拨"}
                </span>
              </div>
              <dl className={styles.facts}>
                <div className={styles.caller}>
                  <dt>主叫 · 当前操作成员</dt>
                  <dd>{currentMemberName}</dd>
                  <dd className={styles.phone}>
                    {data.runtime.callerPhone ?? "尚未绑定接听手机号"}
                  </dd>
                </div>
              </dl>
            </section>
            {!data.runtime.available ? (
              <Alert
                type="info"
                showIcon
                title={
                  SETUP_REASONS[data.runtime.reason ?? ""] ??
                  "电话外呼暂不可用，请联系管理员"
                }
              />
            ) : null}
            {!fields.length ? (
              <Empty description="这条记录没有可拨打的电话字段" />
            ) : (
              <>
                <label className={styles.control}>
                  拨打字段
                  <select
                    className={styles.select}
                    aria-label="拨打字段"
                    value={fieldKey}
                    disabled={Boolean(attempt) || submit.isPending}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setConfirmation(undefined);
                    }}
                  >
                    {fields.map((field) => (
                      <option key={field.fieldKey} value={field.fieldKey}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.facts}>
                  <div>
                    <span className={styles.hint}>被叫号码</span>
                    <strong className={styles.phone}>
                      {String(phone ?? "") || "字段未填写号码"}
                    </strong>
                  </div>
                </div>
                <p className={styles.hint}>
                  {data.runtime.mode === "MOCK"
                    ? "模拟会立即返回演示结果，不会呼叫手机，也不会新增真实通话活动"
                    : "发起后请先接听自己的手机，再由系统接通客户"}
                </p>
                <Checkbox
                  checked={confirmed}
                  disabled={Boolean(attempt) || !data.runtime.available}
                  onChange={(event) =>
                    setConfirmation(
                      event.target.checked ? reviewKey : undefined,
                    )
                  }
                >
                  我已核对主叫和被叫号码
                </Checkbox>
                <Button
                  type="primary"
                  icon={<PhoneOutlined aria-hidden />}
                  loading={submit.isPending}
                  disabled={
                    submit.isPending ||
                    !confirmed ||
                    !data.runtime.available ||
                    !phone
                  }
                  onClick={dial}
                >
                  {attempt
                    ? "重试本次请求"
                    : data.runtime.mode === "MOCK"
                      ? "确认模拟拨打"
                      : "确认拨打"}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
