"use client";

import { Alert, Button, Modal, Typography } from "antd";

import {
  PUBLICATION_CHANGE_LABELS,
  type PublicationAnalysis,
  type PublicationChange,
  type PublicationIssue,
} from "./object-types";

import styles from "./objects.module.css";

export interface PublicationPanelProps {
  open: boolean;
  analysis?: PublicationAnalysis;
  loading?: boolean;
  publishing?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Runs the publication check again after the draft was fixed. */
  onRecheck?: () => void;
  /** Takes the administrator to where an issue can be fixed. */
  onLocate?: (issue: PublicationIssue) => void;
  /** The field's name, shown beside its key. */
  fieldLabel?: (fieldKey: string) => string | undefined;
}

/**
 * Publication is confirmed against the concrete impact, not a generic "are you
 * sure". Blockers and warnings never share a container: a blocker must be
 * fixed in the draft, a warning is accepted knowingly.
 */
export function PublicationPanel({
  open,
  analysis,
  loading = false,
  publishing = false,
  error,
  onConfirm,
  onClose,
  onRecheck,
  onLocate,
  fieldLabel,
}: PublicationPanelProps) {
  const blocked = (analysis?.blocking.length ?? 0) > 0;
  const hasChanges = (analysis?.changes.length ?? 0) > 0;

  return (
    <Modal
      open={open}
      title="发布配置变更"
      onCancel={onClose}
      destroyOnHidden
      footer={[
        blocked ? (
          <span key="why" className={styles.publishBlockedNote}>
            解决「必须先解决」中的问题并保存后，重新检查即可发布
          </span>
        ) : null,
        blocked && onRecheck ? (
          <Button key="recheck" onClick={onRecheck} loading={loading}>
            重新检查
          </Button>
        ) : null,
        <Button key="cancel" onClick={onClose}>
          返回继续编辑
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={publishing}
          disabled={!analysis || blocked || loading || Boolean(error)}
          onClick={onConfirm}
        >
          确认发布
        </Button>,
      ]}
    >
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {loading ? (
        <Typography.Paragraph type="secondary">
          正在分析这次发布的影响…
        </Typography.Paragraph>
      ) : null}

      {analysis && !loading ? (
        <>
          <Typography.Paragraph>
            本次发布会应用此业务表全部已保存的配置，包括员工默认权限。
          </Typography.Paragraph>
          {analysis.blocking.length > 0 ? (
            <IssueGroup
              label="必须先解决"
              issues={analysis.blocking}
              tone="blocking"
              onLocate={onLocate}
              fieldLabel={fieldLabel}
            />
          ) : null}
          {analysis.warnings.length > 0 ? (
            <IssueGroup
              label="发布后请注意"
              issues={analysis.warnings}
              tone="warning"
              onLocate={onLocate}
              fieldLabel={fieldLabel}
            />
          ) : null}
          {hasChanges ? (
            <ChangeGroup changes={analysis.changes} fieldLabel={fieldLabel} />
          ) : (
            <Typography.Paragraph type="secondary">
              本次没有字段结构变更；权限等其他已保存配置仍会随本次发布生效。
            </Typography.Paragraph>
          )}
        </>
      ) : null}
    </Modal>
  );
}

function IssueGroup({
  label,
  issues,
  tone,
  onLocate,
  fieldLabel,
}: {
  label: string;
  issues: PublicationIssue[];
  tone: "blocking" | "warning";
  onLocate?: (issue: PublicationIssue) => void;
  fieldLabel?: (fieldKey: string) => string | undefined;
}) {
  return (
    <section
      role="group"
      aria-label={label}
      className={`${styles.issueGroup} ${
        tone === "blocking"
          ? styles.issueGroupBlocking
          : styles.issueGroupWarning
      }`}
    >
      <span className={styles.issueGroupLabel}>
        {label} · {issues.length} 项
      </span>
      <ul className={styles.issueList}>
        {issues.map((issue) => (
          <li
            key={`${issue.code}-${issue.fieldKey ?? "object"}`}
            className={styles.issue}
          >
            {issue.message}
            {issue.fieldKey ? (
              <span className={styles.stableKey}>
                {" "}
                {fieldLabel?.(issue.fieldKey)
                  ? `${fieldLabel(issue.fieldKey)}（${issue.fieldKey}）`
                  : issue.fieldKey}
              </span>
            ) : null}
            {onLocate &&
            (issue.fieldKey || issue.transitionKey || issue.actionKey) ? (
              <Button
                type="link"
                size="small"
                className={styles.issueLocate}
                onClick={() => onLocate(issue)}
              >
                去修改
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeGroup({
  changes,
  fieldLabel,
}: {
  changes: PublicationChange[];
  fieldLabel?: (fieldKey: string) => string | undefined;
}) {
  return (
    <section role="group" aria-label="本次变更" className={styles.issueGroup}>
      <span className={styles.issueGroupLabel}>本次变更</span>
      <ul className={styles.changeList}>
        {changes.map((change) => (
          <li
            key={`${change.kind}-${change.fieldKey}`}
            className={styles.change}
          >
            <span>{PUBLICATION_CHANGE_LABELS[change.kind]}</span>
            {fieldLabel?.(change.fieldKey) ? (
              <span>{fieldLabel(change.fieldKey)}</span>
            ) : null}
            <span className={styles.stableKey}>{change.fieldKey}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
