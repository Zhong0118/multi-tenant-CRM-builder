"use client";

import {
  Alert,
  Button,
  Drawer,
  Empty,
  Skeleton,
  Space,
  Typography,
} from "antd";

import type {
  BusinessTemplateVersion,
  TemplatePublicationAnalysis,
} from "./template-types";
import { StatusTag } from "@/components/workbench/status-tag";
import type { TemplateDraft } from "./template-draft";

import styles from "./templates.module.css";

export interface TemplatePublicationPanelProps {
  open: boolean;
  draft: TemplateDraft;
  analysis?: TemplatePublicationAnalysis;
  versions: BusinessTemplateVersion[];
  loading: boolean;
  publishing: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function TemplatePublicationPanel({
  open,
  draft,
  analysis,
  versions,
  loading,
  publishing,
  error,
  onConfirm,
  onClose,
}: TemplatePublicationPanelProps) {
  const groupedBlocking = groupIssues(analysis?.blocking ?? [], draft);
  const groupedWarnings = groupIssues(analysis?.warnings ?? [], draft);
  const blocked = !analysis || analysis.blocking.length > 0;

  return (
    <Drawer
      open={open}
      title="发布模板"
      size={560}
      destroyOnHidden
      onClose={onClose}
      footer={
        <div className={styles.drawerFooter}>
          <Button aria-label="关闭" onClick={onClose}>
            关闭
          </Button>
          <Button
            type="primary"
            disabled={blocked || loading}
            loading={publishing}
            onClick={onConfirm}
          >
            确认发布
          </Button>
        </div>
      }
    >
      <Typography.Paragraph type="secondary">
        发布会冻结当前完整模板为不可变版本，不会直接修改任何公司对象。
      </Typography.Paragraph>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {!loading && analysis ? (
        <Space orientation="vertical" size={20} style={{ width: "100%" }}>
          <div className={styles.analysisSummary}>
            <span>{analysis.objectCount} 个业务对象</span>
            <span>{analysis.fieldCount} 个字段</span>
            <span>
              {analysis.blocking.length === 0
                ? "可以发布"
                : `${analysis.blocking.length} 项必须处理`}
            </span>
          </div>
          {groupedBlocking.length > 0 ? (
            <IssueGroups title="发布阻断" groups={groupedBlocking} blocking />
          ) : (
            <Alert
              type="success"
              showIcon
              title="发布检查已通过"
              description="确认后将创建新的模板版本，并把它标记为当前发布身份。"
            />
          )}
          {groupedWarnings.length > 0 ? (
            <IssueGroups title="需要确认" groups={groupedWarnings} />
          ) : null}
          <section>
            <h3 className={styles.panelHeading}>本次变化</h3>
            {analysis.changes.length === 0 ? (
              <Typography.Text type="secondary">
                当前草稿与发布版本一致。
              </Typography.Text>
            ) : (
              <ul className={styles.changeList}>
                {analysis.changes.map((change, index) => {
                  const object = draft.objects.find(
                    (item) => item.object.id === change.objectId,
                  );
                  const field = object?.fields.find(
                    (item) => item.fieldKey === change.fieldKey,
                  );
                  return (
                    <li
                      key={`${change.objectId}-${change.fieldKey ?? "object"}-${index}`}
                    >
                      <StatusTag>{CHANGE_LABELS[change.kind]}</StatusTag>
                      <span>
                        {change.entity === "OBJECT"
                          ? (object?.object.name ?? change.objectId)
                          : `${object?.object.name ?? change.objectId} · ${field?.label ?? change.fieldKey}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h3 className={styles.panelHeading}>版本历史</h3>
            {versions.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="首次发布后，版本历史会显示在这里。"
              />
            ) : (
              <div className={styles.versionList}>
                {versions.map((version) => (
                  <div key={version.id} className={styles.versionRow}>
                    <span className={styles.versionNumber}>
                      v{version.versionNo}
                    </span>
                    <span>来自草稿 {version.sourceDraftVersion}</span>
                    <time dateTime={version.publishedAt}>
                      {formatDate(version.publishedAt)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </section>
        </Space>
      ) : null}
    </Drawer>
  );
}

function IssueGroups({
  title,
  groups,
  blocking = false,
}: {
  title: string;
  groups: IssueGroup[];
  blocking?: boolean;
}) {
  return (
    <section>
      <h3 className={styles.panelHeading}>{title}</h3>
      <div className={styles.issueGroups}>
        {groups.map((group) => (
          <div key={group.objectId} className={styles.issueGroup}>
            <strong>{group.objectName}</strong>
            <ul>
              {group.issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.fieldKey ?? index}`}>
                  {blocking ? (
                    <StatusTag tone="danger">阻断</StatusTag>
                  ) : (
                    <StatusTag tone="warning">提醒</StatusTag>
                  )}
                  <span>{issue.message}</span>
                  {issue.fieldKey ? <code>{issue.fieldKey}</code> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

type Issue = TemplatePublicationAnalysis["blocking"][number];
interface IssueGroup {
  objectId: string;
  objectName: string;
  issues: Issue[];
}

function groupIssues(issues: Issue[], draft: TemplateDraft): IssueGroup[] {
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    grouped.set(issue.objectId, [
      ...(grouped.get(issue.objectId) ?? []),
      issue,
    ]);
  }
  return [...grouped.entries()].map(([objectId, objectIssues]) => ({
    objectId,
    objectName:
      objectId === ""
        ? "模板"
        : (draft.objects.find((item) => item.object.id === objectId)?.object
            .name ?? "未知业务对象"),
    issues: objectIssues,
  }));
}

const CHANGE_LABELS: Record<
  TemplatePublicationAnalysis["changes"][number]["kind"],
  string
> = {
  ADDED: "新增",
  UPDATED: "修改",
  INACTIVATED: "停用",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
