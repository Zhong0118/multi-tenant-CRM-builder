"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { StatusTag } from "@/components/workbench/status-tag";
import { toApiError } from "@/lib/api/api-error";

import type { ObjectApi } from "./object-api";
import type { ObjectDraft } from "./object-types";
import designer from "./object-designer.module.css";
import styles from "./objects.module.css";

const CHANGE_KIND_LABELS = {
  ADDED: "新增",
  UPDATED: "修改",
  INACTIVATED: "停用",
} as const;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * 发布与停用: what each kind of change does and when, where the table stands,
 * the whole-table lifecycle, and every publication with what it changed.
 */
export function PublicationHistorySection({
  tenantCode,
  draft,
  api,
  publishing,
  publishBlocked,
  onPublish,
  lifecycle,
}: {
  tenantCode: string;
  draft: ObjectDraft;
  api: ObjectApi;
  publishing: boolean;
  publishBlocked: boolean;
  onPublish: () => void;
  lifecycle: ReactNode;
}) {
  const history = useQuery({
    queryKey: [
      "workspace",
      tenantCode,
      "object-publications",
      draft.object.id,
      draft.object.publicationNumber,
    ],
    queryFn: () => api.listPublications(tenantCode, draft.object.id),
  });
  const archived = draft.object.status === "ARCHIVED";
  const live = draft.object.publicationNumber;
  const labelOf = (fieldKey: string) =>
    draft.fields.find((field) => field.fieldKey === fieldKey)?.label ??
    fieldKey;
  const publications = [...(history.data ?? [])].sort(
    (a, b) => b.number - a.number,
  );

  return (
    <section className={styles.panel} aria-label="发布与停用">
      <div className={designer.statusStrip}>
        <div>
          <span className={designer.statusLabel}>员工正在使用</span>
          <strong>
            {live === null ? "尚未发布" : `v${live}`}
            {archived ? "（已停用）" : null}
          </strong>
          {live !== null ? (
            <span className={designer.statusMeta}>
              发布于 {formatDateTime(draft.object.publishedAt)}
            </span>
          ) : null}
        </div>
        <div>
          <span className={designer.statusLabel}>草稿</span>
          <strong>修订 {draft.object.version}</strong>
          <span className={designer.statusMeta}>
            {archived
              ? "已停用，配置只读"
              : live === null
                ? "发布后员工才能使用这张表"
                : draft.object.hasUnpublishedChanges
                  ? "有未发布的修改"
                  : "与员工使用的版本一致"}
          </span>
        </div>
        {!archived ? (
          <Button
            type={
              draft.object.hasUnpublishedChanges || live === null
                ? "primary"
                : "default"
            }
            loading={publishing}
            disabled={publishBlocked}
            title={publishBlocked ? "请先保存或放弃未保存的修改" : undefined}
            onClick={onPublish}
          >
            检查并发布
          </Button>
        ) : null}
      </div>

      <h3 className={designer.blockTitle}>每种操作的影响</h3>
      <table className={designer.effectTable} aria-label="每种操作的影响">
        <thead>
          <tr>
            <th scope="col">操作</th>
            <th scope="col">改变什么</th>
            <th scope="col">员工何时看到</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">保存（各配置页）</th>
            <td>
              只改草稿：字段、表单顺序、列表、员工默认权限、流程和跨表规则
            </td>
            <td>发布之后</td>
          </tr>
          <tr>
            <th scope="row">发布</th>
            <td>
              发布前先检查，有阻断问题时不能发布；通过后草稿成为新版本
              {live === null ? " v1" : ` v${live + 1}`}
              ，所有员工改用新版本，已有记录保留
            </td>
            <td>立即</td>
          </tr>
          <tr>
            <th scope="row">停用业务表</th>
            <td>员工端隐藏这张表，管理员只读；记录、配置和发布记录都保留</td>
            <td>立即</td>
          </tr>
          <tr>
            <th scope="row">恢复业务表</th>
            <td>回到停用前发布的版本，不会顺带发布草稿</td>
            <td>立即</td>
          </tr>
          <tr>
            <th scope="row">成员例外</th>
            <td>
              只对某位员工放宽或收紧权限，在
              <Link href={`/workspace/${tenantCode}/members`}>成员</Link>
              中设置，不经过发布
            </td>
            <td>保存后立即</td>
          </tr>
        </tbody>
      </table>

      <div className={designer.lifecycleRow}>
        <div>
          <h3 className={designer.blockTitle}>停用与恢复</h3>
          <p className={designer.muted}>
            {archived
              ? `已停用 · 上次发布版本 v${draft.object.publicationNumber} · ${draft.object.archivedAt ? formatDateTime(draft.object.archivedAt) : "缺少历史停用时间"}`
              : live === null
                ? "尚未发布的业务表没有可停用的版本；不再需要时可在页面右上角删除草稿。"
                : "停用前会列出受影响的记录和依赖，确认后才执行。"}
          </p>
        </div>
        {lifecycle}
      </div>

      <h3 className={designer.blockTitle}>
        发布记录
        <span>发布版本不可回滚</span>
      </h3>
      {live === null ? (
        <p className={designer.muted}>该对象尚未发布，成员还看不到它。</p>
      ) : history.isPending ? (
        <p className={designer.muted} role="status">
          正在载入发布记录…
        </p>
      ) : history.isError ? (
        <Alert
          type="error"
          showIcon
          title={`发布记录读取失败：${toApiError(history.error).message}`}
          action={
            <Button size="small" onClick={() => void history.refetch()}>
              重试
            </Button>
          }
        />
      ) : (
        <ol className={designer.timeline} aria-label="发布记录">
          {publications.map((publication) => (
            <li
              key={publication.id}
              data-current={publication.number === live || undefined}
            >
              <span className={designer.timelineVersion}>
                v{publication.number}
              </span>
              <div>
                <p className={designer.timelineHead}>
                  <strong>{formatDateTime(publication.publishedAt)}</strong>
                  {publication.number === live ? (
                    <StatusTag tone={archived ? "neutral" : "success"}>
                      {archived ? "停用前发布版本" : "当前运行版本"}
                    </StatusTag>
                  ) : null}
                  <span>来自草稿修订 {publication.sourceDraftVersion}</span>
                </p>
                {publication.changes.length ? (
                  <ul className={designer.changeList}>
                    {publication.changes.map((change) => (
                      <li
                        key={`${change.kind}:${change.fieldKey}`}
                        data-kind={change.kind}
                      >
                        {CHANGE_KIND_LABELS[change.kind]}字段「
                        {labelOf(change.fieldKey)}」
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={designer.muted}>
                    没有字段变化（权限、列表、流程或规则的调整）
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
