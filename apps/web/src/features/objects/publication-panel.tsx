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
        <Button key="cancel" onClick={onClose}>
          返回继续编辑
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={publishing}
          disabled={blocked || loading || Boolean(error)}
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
          {analysis.blocking.length > 0 ? (
            <IssueGroup
              label="必须先解决"
              issues={analysis.blocking}
              tone="blocking"
            />
          ) : null}
          {analysis.warnings.length > 0 ? (
            <IssueGroup
              label="发布后请注意"
              issues={analysis.warnings}
              tone="warning"
            />
          ) : null}
          {hasChanges ? (
            <ChangeGroup changes={analysis.changes} />
          ) : (
            <Typography.Paragraph type="secondary">
              本次发布没有配置变更。
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
}: {
  label: string;
  issues: PublicationIssue[];
  tone: "blocking" | "warning";
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
      <span className={styles.issueGroupLabel}>{label}</span>
      <ul className={styles.issueList}>
        {issues.map((issue) => (
          <li
            key={`${issue.code}-${issue.fieldKey ?? "object"}`}
            className={styles.issue}
          >
            {issue.message}
            {issue.fieldKey ? (
              <span className={styles.stableKey}> {issue.fieldKey}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeGroup({ changes }: { changes: PublicationChange[] }) {
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
            <span className={styles.stableKey}>{change.fieldKey}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
