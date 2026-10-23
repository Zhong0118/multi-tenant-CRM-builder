"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Modal, Spin } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import type { ObjectApi } from "./object-api";
import type { ObjectDraft } from "./object-types";
import styles from "./objects.module.css";

/** Preview and mutation share the version the administrator explicitly viewed. */
export function ObjectLifecycleControl({
  tenantCode,
  draft,
  api,
  onChanged,
  labelled = false,
  autoStart = false,
  onClose,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  api: ObjectApi;
  onChanged: (next: ObjectDraft) => void;
  labelled?: boolean;
  /** Open the check at once with no button of its own, as from a row menu. */
  autoStart?: boolean;
  /** Called when the dialog closes, so a menu-driven caller can unmount it. */
  onClose?: () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string>();
  const archived = draft.object.status === "ARCHIVED";
  const action = archived ? "恢复" : "停用";
  const preview = useMutation({
    mutationFn: () => api.lifecycle(tenantCode, draft.object.id),
  });
  const impact = preview.data;
  const [conflicted, setConflicted] = useState(false);
  const stale =
    conflicted ||
    (impact !== undefined &&
      (impact.version !== draft.object.version ||
        impact.status !== draft.object.status));
  const blocked =
    !impact ||
    impact.blockers.length > 0 ||
    stale ||
    preview.isPending ||
    preview.isError ||
    (impact.requiresLegacyTimerAcknowledgement && !acknowledged);
  const refresh = useMutation({
    mutationFn: () => api.draft(tenantCode, draft.object.id),
    onSuccess: (next) => {
      onChanged(next);
      close();
      router.refresh();
    },
  });
  const change = useMutation({
    mutationFn: () =>
      archived
        ? api.restore(
            tenantCode,
            draft.object.id,
            draft.object.version,
            acknowledged,
          )
        : api.archive(tenantCode, draft.object.id, draft.object.version),
    onSuccess: (next) => {
      onChanged(next);
      close();
      setNotice(
        archived
          ? "业务表已恢复，沿用原发布版本，草稿未发布"
          : "业务表已停用，配置和历史数据已保留",
      );
      void client.invalidateQueries({ queryKey: ["workspace", tenantCode] });
      router.refresh();
    },
    onError: (caught) =>
      setConflicted(toApiError(caught).code === "CONFIG_VERSION_CONFLICT"),
  });
  const pending = change.isPending || refresh.isPending;
  const start = () => {
    setOpen(true);
    setNotice(undefined);
    setAcknowledged(false);
    setConflicted(false);
    change.reset();
    refresh.reset();
    preview.reset();
    preview.mutate();
  };
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    start();
    // Starting once on mount is the point; start is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  const failure = refresh.error ?? change.error ?? preview.error;
  const apiError = failure ? toApiError(failure) : undefined;
  if (draft.object.publicationNumber === null) return null;

  return (
    <div className={styles.lifecycleControl}>
      {autoStart ? null : (
        <Button
          danger={!archived}
          aria-label={
            labelled ? `${action}业务表 ${draft.object.name}` : undefined
          }
          disabled={pending}
          onClick={start}
        >
          {action}业务表
        </Button>
      )}
      {notice && !autoStart ? <Alert type="success" showIcon title={notice} /> : null}
      <Modal
        title={`${action}业务表「${draft.object.name}」`}
        open={open}
        okText={`确认${action}`}
        cancelText="取消"
        confirmLoading={change.isPending}
        okButtonProps={{ disabled: blocked || pending, danger: !archived }}
        cancelButtonProps={{ disabled: pending }}
        closable={!pending}
        mask={{ closable: !pending }}
        keyboard={!pending}
        onCancel={close}
        onOk={() => {
          if (!blocked && !pending) change.mutate();
        }}
      >
        <div className={styles.lifecycleSummary}>
          {preview.isPending ? (
            <Spin description="正在检查影响和依赖">
              <div style={{ minHeight: 64 }} />
            </Spin>
          ) : null}
          {impact ? (
            <>
              <p>
                <strong>{impact.recordCount} 条业务记录</strong> · 上次发布版本
                v{impact.activePublicationVersion}
              </p>
              <p>
                {impact.hasUnpublishedChanges
                  ? "存在待发布草稿，草稿不会发布"
                  : "没有待发布草稿"}
              </p>
              {archived ? (
                <p>
                  停用时间：
                  {impact.archivedAt
                    ? new Date(impact.archivedAt).toLocaleString("zh-CN")
                    : "缺少历史停用时间"}
                </p>
              ) : null}
              <Alert
                type="info"
                showIcon
                title="确认后立即生效，无需发布"
                description={
                  archived
                    ? "恢复后沿用停用前的已发布版本和原有权限，草稿不会发布。自动扫描恢复，停用时尚未到期的公海期限顺延停用时长；已到期记录及人工跟进截止日期保持原样。"
                    : "所有角色的业务入口关闭，配置变为只读。记录、字段、负责人、跟进、附件、关系和发布历史保留。公海计时暂停，自动回收与提醒停止扫描。"
                }
              />
              {impact.blockers.length ? (
                <Alert
                  type="warning"
                  showIcon
                  title="请先处理以下依赖"
                  description={
                    <ul>
                      {impact.blockers.map((item, index) => (
                        <li key={`${item.objectCode}:${index}`}>
                          <strong>
                            {item.objectName}（{item.objectCode}）
                          </strong>
                          ：{item.description}
                        </li>
                      ))}
                    </ul>
                  }
                />
              ) : (
                <p>没有阻止操作的依赖</p>
              )}
              {impact.requiresLegacyTimerAcknowledgement ? (
                <Alert
                  type="warning"
                  showIcon
                  title={`缺少历史停用时间，${impact.expiredRecordCount} 条已到期`}
                  description={
                    <>
                      <p>
                        无法推算暂停时长，恢复后自动回收将按原期限处理已到期记录。
                      </p>
                      <Checkbox
                        checked={acknowledged}
                        disabled={pending}
                        onChange={(event) =>
                          setAcknowledged(event.target.checked)
                        }
                      >
                        我确认保留原有公海期限并恢复自动任务
                      </Checkbox>
                    </>
                  }
                />
              ) : null}
            </>
          ) : null}
          {stale ? (
            <Alert
              type="warning"
              showIcon
              title="配置已变化，请重新载入配置后再次检查"
              action={
                <Button
                  loading={refresh.isPending}
                  disabled={change.isPending}
                  onClick={() => refresh.mutate()}
                >
                  重新载入配置
                </Button>
              }
            />
          ) : null}
          {apiError ? (
            <Alert
              type="error"
              showIcon
              title={`${apiError.message}（请求编号：${apiError.requestId}）`}
              action={
                !stale ? (
                  <Button
                    disabled={pending || preview.isPending}
                    onClick={() => {
                      change.reset();
                      refresh.reset();
                      preview.mutate();
                    }}
                  >
                    重试检查
                  </Button>
                ) : undefined
              }
            />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
