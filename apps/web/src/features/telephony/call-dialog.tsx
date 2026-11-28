"use client";

import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
  MinusCircleFilled,
} from "@ant-design/icons";
import { Alert, Button, Modal, Radio, Skeleton } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { toApiError, type ApiError } from "@/lib/api/api-error";

import {
  OPEN_STATUSES,
  UNAVAILABLE_REASON,
  dialable,
  formatDuration,
  formatPhone,
  telephonyApi,
  type TelephonyCall,
} from "./telephony-api";
import { useTelephonyRuntime } from "./use-telephony";
import styles from "./telephony.module.css";

export interface CallTarget {
  objectCode: string;
  recordId: string;
  recordTitle: string;
  /** The record's values, so the dialog can show the number it will dial. */
  values: Record<string, unknown>;
  fieldKey?: string;
}

/** The backend refuses to close a call younger than this; the line may still be ringing. */
const CLOSE_AFTER_MS = 60_000;

/**
 * Dial one customer through the company line: the number, the member's own
 * phone the line rings first, one button, then the outcome in place.
 */
export function CallDialog({
  tenantCode,
  target,
  onClose,
  onFollowUp,
}: {
  tenantCode: string;
  target: CallTarget | null;
  onClose: () => void;
  /** Where to write a note about the call; omitted where there is nowhere to. */
  onFollowUp?: () => void;
}) {
  return (
    <Modal
      open={Boolean(target)}
      title={target ? `拨给 ${target.recordTitle}` : undefined}
      width={400}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
      maskClosable={false}
    >
      {target ? (
        <CallPanel
          tenantCode={tenantCode}
          target={target}
          onClose={onClose}
          onFollowUp={onFollowUp}
        />
      ) : null}
    </Modal>
  );
}

function CallPanel({
  tenantCode,
  target,
  onClose,
  onFollowUp,
}: {
  tenantCode: string;
  target: CallTarget;
  onClose: () => void;
  onFollowUp?: () => void;
}) {
  const client = useQueryClient();
  const runtime = useTelephonyRuntime(
    tenantCode,
    target.objectCode,
    target.recordId,
  );
  // One request per dialog: pressing 呼叫 again after a lost response asks for
  // the same call, which the server answers without dialling twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const [chosen, setChosen] = useState(target.fieldKey);
  const [callId, setCallId] = useState<string>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  const options = (runtime.data?.fields ?? []).filter((field) =>
    dialable(target.values[field.fieldKey]),
  );
  const fieldKey =
    options.find((field) => field.fieldKey === chosen)?.fieldKey ??
    options[0]?.fieldKey;
  const shownCallId = callId ?? runtime.data?.openCallId ?? undefined;

  const call = useQuery({
    queryKey: ["telephony-call", tenantCode, shownCallId],
    queryFn: () => telephonyApi.call(tenantCode, shownCallId!),
    enabled: Boolean(shownCallId),
    refetchInterval: (query) =>
      query.state.data && OPEN_STATUSES.has(query.state.data.status)
        ? 2_000
        : false,
  });
  const status = call.data?.status;
  const open = status ? OPEN_STATUSES.has(status) : false;

  // A finished call wrote its outcome to the record and the call log.
  useEffect(() => {
    if (!status || open) return;
    void client.invalidateQueries({
      queryKey: ["telephony-calls", tenantCode],
    });
    void client.invalidateQueries({
      queryKey: ["telephony-runtime", tenantCode],
    });
    void client.invalidateQueries({
      queryKey: [
        "workspace",
        tenantCode,
        "objects",
        target.objectCode,
        "records",
        target.recordId,
        "activities",
      ],
    });
  }, [client, open, status, target.objectCode, target.recordId, tenantCode]);

  // The clock only matters while a call is open, for the 结束这通 button.
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const dial = useMutation({
    mutationFn: () =>
      telephonyApi.createCall(tenantCode, {
        requestId,
        objectCode: target.objectCode,
        recordId: target.recordId,
        fieldKey: fieldKey!,
        confirmation: {
          mode: runtime.data!.mode,
          callerPhone: runtime.data!.callerPhone ?? "",
          calleePhone: String(target.values[fieldKey!]),
        },
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(["telephony-call", tenantCode, result.id], result);
      setCallId(result.id);
    },
    onError: (cause) => {
      const apiError = cause instanceof Error ? null : (cause as ApiError);
      if (!apiError || apiError.status >= 500) {
        setError(
          apiError?.message && apiError.status !== 500
            ? apiError.message
            : "网络中断，不确定是否已拨出。再点「呼叫」不会重复拨号。",
        );
        return;
      }
      setError(apiError.message);
      // Another open call, or the numbers changed: show what is true now.
      if (apiError.status === 409) void runtime.refetch();
    },
  });
  const close = useMutation({
    mutationFn: () => telephonyApi.closeCall(tenantCode, shownCallId!),
    onMutate: () => setError(undefined),
    onSuccess: (result) =>
      client.setQueryData(["telephony-call", tenantCode, result.id], result),
    onError: (cause) => setError(toApiError(cause).message),
  });

  if (runtime.isError)
    return (
      <Alert type="error" showIcon title={toApiError(runtime.error).message} />
    );
  if (!runtime.data) return <Skeleton active paragraph={{ rows: 2 }} />;
  const state = runtime.data;

  if (shownCallId) {
    if (!call.data)
      return call.isError ? (
        <Alert type="error" showIcon title={toApiError(call.error).message} />
      ) : (
        <Skeleton active paragraph={{ rows: 1 }} />
      );
    const elapsed = now - new Date(call.data.createdAt).getTime();
    return (
      <div className={styles.callBody}>
        {callId === undefined ? (
          <p className={styles.callNote}>你还有一通电话没有结束：</p>
        ) : null}
        <CallOutcome call={call.data} />
        {error ? <Alert type="error" showIcon title={error} /> : null}
        <div className={styles.callActions}>
          {open ? (
            elapsed >= CLOSE_AFTER_MS ? (
              <Button loading={close.isPending} onClick={() => close.mutate()}>
                结束这通
              </Button>
            ) : (
              <Button onClick={onClose}>后台等待</Button>
            )
          ) : (
            <>
              {onFollowUp && callId !== undefined ? (
                <Button
                  onClick={() => {
                    onClose();
                    onFollowUp();
                  }}
                >
                  写跟进
                </Button>
              ) : null}
              <Button type="primary" onClick={onClose}>
                完成
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!state.available)
    return (
      <div className={styles.callBody}>
        <p className={styles.callNote}>
          {UNAVAILABLE_REASON[state.reason ?? ""] ?? "现在不能外呼"}
        </p>
        <div className={styles.callActions}>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    );
  if (!fieldKey)
    return (
      <div className={styles.callBody}>
        <p className={styles.callNote}>这条记录没有可拨打的手机号。</p>
        <div className={styles.callActions}>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    );

  return (
    <div className={styles.callBody}>
      <dl className={styles.callFacts}>
        <div>
          <dt>客户电话</dt>
          <dd>
            {options.length > 1 ? (
              <Radio.Group
                className={styles.callChoices}
                value={fieldKey}
                onChange={(event) => setChosen(event.target.value as string)}
                options={options.map((field) => ({
                  value: field.fieldKey,
                  label: (
                    <span className={styles.callChoice}>
                      <span>
                        {formatPhone(String(target.values[field.fieldKey]))}
                      </span>
                      <span className={styles.muted}>{field.label}</span>
                    </span>
                  ),
                }))}
              />
            ) : (
              <span className={styles.phone}>
                {formatPhone(String(target.values[fieldKey]))}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>回拨到</dt>
          <dd>
            <span className={styles.phone}>
              {formatPhone(state.callerPhone)}
            </span>
            <span className={styles.muted}>我的手机</span>
          </dd>
        </div>
      </dl>
      <p className={styles.callNote}>
        {state.mode === "MOCK"
          ? "模拟线路：不会拨出真实电话。"
          : "线路先打你的手机，接听后自动拨给客户。"}
      </p>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <Button
        type="primary"
        block
        loading={dial.isPending}
        onClick={() => dial.mutate()}
      >
        呼叫
      </Button>
    </div>
  );
}

const OUTCOME: Record<
  string,
  { icon: ReactNode; tone: string; title: (call: TelephonyCall) => string }
> = {
  REQUESTED: {
    icon: <LoadingOutlined />,
    tone: "info",
    title: () => "正在提交…",
  },
  ACCEPTED: {
    icon: <LoadingOutlined />,
    tone: "info",
    title: () => "正在回拨你的手机…",
  },
  UNKNOWN: {
    icon: <ExclamationCircleFilled />,
    tone: "warning",
    title: () => "线路没有明确回应，等待结果",
  },
  CONNECTED: {
    icon: <CheckCircleFilled />,
    tone: "success",
    title: (call) =>
      call.durationSeconds
        ? `已接通 · ${formatDuration(call.durationSeconds)}`
        : "已接通",
  },
  NOT_CONNECTED: {
    icon: <MinusCircleFilled />,
    tone: "neutral",
    title: () => "未接通",
  },
  ENDED: {
    icon: <MinusCircleFilled />,
    tone: "neutral",
    title: () => "已结束",
  },
  FAILED: {
    icon: <CloseCircleFilled />,
    tone: "danger",
    title: () => "线路拒绝",
  },
};

function CallOutcome({ call }: { call: TelephonyCall }) {
  const outcome = OUTCOME[call.status] ?? OUTCOME.ENDED;
  const detail =
    call.status === "FAILED"
      ? (call.failureReason ?? "线路没有说明原因")
      : call.status === "ACCEPTED"
        ? "接听后线路自动拨给客户"
        : call.status === "UNKNOWN"
          ? "结果到达后自动更新，不会重复拨号"
          : call.calleePhone
            ? `${call.recordTitle ?? ""} ${formatPhone(call.calleePhone)}`.trim()
            : null;
  return (
    <div className={styles.outcome} data-tone={outcome.tone} role="status">
      <span className={styles.outcomeIcon} aria-hidden>
        {outcome.icon}
      </span>
      <div>
        <strong>{outcome.title(call)}</strong>
        {detail ? <p className={styles.muted}>{detail}</p> : null}
      </div>
    </div>
  );
}
