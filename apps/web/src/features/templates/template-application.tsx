"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Select, Spin } from "antd";
import { useEffect, useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import { browserTemplateApi, type TemplateApi } from "./template-api";
import type {
  BusinessTemplate,
  BusinessTemplateVersion,
  TemplateApplication,
  TenantBusinessConfigurationSummary,
} from "./template-types";
import styles from "./templates.module.css";

export interface TenantBusinessConfigurationTarget {
  id: string;
  name: string;
  code: string;
  status: "DRAFT" | "ACTIVE" | "CLOSED" | "SUSPENDED";
}

export interface TenantBusinessConfigurationProps {
  tenant: TenantBusinessConfigurationTarget;
  initialSummary: TenantBusinessConfigurationSummary;
  api?: TemplateApi;
}

export function TenantBusinessConfiguration({
  tenant,
  initialSummary,
  api = browserTemplateApi,
}: TenantBusinessConfigurationProps) {
  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const [result, setResult] = useState<TemplateApplication | null>(null);
  const [error, setError] = useState<string>();
  const [summary, setSummary] =
    useState<TenantBusinessConfigurationSummary>(initialSummary);
  const queryClient = useQueryClient();
  const templateListKey = ["business-templates", "applicable", tenant.id] as const;

  const templates = useQuery({
    queryKey: templateListKey,
    queryFn: () => api.list({ page: 1, limit: 20, hasActiveVersion: true }),
    enabled: open,
  });
  useEffect(() => {
    if (!selectedTemplateId && templates.data?.items[0]) {
      setSelectedTemplateId(templates.data.items[0].id);
    }
  }, [selectedTemplateId, templates.data]);

  const selectedTemplate = templates.data?.items.find(
    (template) => template.id === selectedTemplateId,
  );
  const versionKey = [
    "business-template",
    selectedTemplateId,
    "versions",
  ] as const;
  const versions = useQuery({
    queryKey: versionKey,
    queryFn: () => api.listVersions(selectedTemplateId!),
    enabled: open && Boolean(selectedTemplateId),
  });
  const selectedVersion = versions.data?.find(
    (version) => version.id === selectedTemplate?.activeVersion?.id,
  );

  const application = useMutation({
    mutationFn: async ({
      template,
      version,
    }: {
      template: BusinessTemplate;
      version: BusinessTemplateVersion;
    }) => {
      return api.apply(template.id, {
        tenantId: tenant.id,
        templateVersionId: version.id,
      });
    },
    onSuccess: (next) => {
      setResult(next);
      setSummary({
        objectCount: next.objects.length,
        canApplyTemplate: false,
        blockingReason: "TARGET_NOT_EMPTY",
        application: next,
      });
      setOpen(false);
      resetModalState();
    },
    onError: (cause) => {
      const apiError = toApiError(cause);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  const displayedResult = result ?? summary.application;
  const previewReady = Boolean(selectedTemplate && selectedVersion);
  const versionUnavailable = versions.isSuccess && !selectedVersion;
  const pending = application.isPending;

  function resetModalState() {
    queryClient.removeQueries({ queryKey: templateListKey });
    if (selectedTemplateId) {
      queryClient.removeQueries({ queryKey: versionKey });
    }
    setError(undefined);
    setSelectedTemplateId(undefined);
  }

  function closeModal() {
    if (pending) return;
    resetModalState();
    setOpen(false);
  }

  return (
    <section id="business-configuration" className={styles.applicationPanel}>
      <div className={styles.applicationHeading}>
        <div>
          <h2>业务配置</h2>
          <p>当前公司已有 {summary.objectCount} 个业务对象。</p>
        </div>
        {summary.canApplyTemplate ? (
          <Button type="primary" onClick={() => setOpen(true)}>
            应用业务模板
          </Button>
        ) : null}
      </div>

      {displayedResult ? <ApplicationResult result={displayedResult} /> : null}
      {!displayedResult && !summary.canApplyTemplate ? (
        <p className={styles.applicationBlocked}>
          {blockingReasonText(summary.blockingReason)}
        </p>
      ) : null}

      <Modal
        title="应用业务模板"
        open={open}
        onCancel={closeModal}
        closable={!pending}
        mask={{ closable: !pending }}
        keyboard={!pending}
        footer={[
          <Button key="cancel" disabled={pending} onClick={closeModal}>
            取消
          </Button>,
          <Button
            key="confirm"
            type="primary"
            loading={pending}
            disabled={!previewReady || pending}
            onClick={() =>
              selectedTemplate &&
              selectedVersion &&
              application.mutate({ template: selectedTemplate, version: selectedVersion })
            }
          >
            确认应用
          </Button>,
        ]}
      >
        <div className={styles.applicationModalContent}>
          <p className={styles.applicationIntro}>
            为 {tenant.name} 选择一个已发布模板作为初始业务配置。
          </p>
          {error ? <Alert type="error" showIcon title={error} /> : null}
          {templates.isLoading ? <Spin /> : null}
          {templates.isError ? (
            <QueryFailure
              title="加载可应用模板失败"
              error={templates.error}
              onRetry={() => void templates.refetch()}
            />
          ) : null}
          {templates.data?.items.length === 0 ? (
            <p className={styles.applicationBlocked}>没有可应用的已发布模板。</p>
          ) : null}
          {templates.data?.items.length ? (
            <label className={styles.templateSelectLabel}>
              <span>选择模板</span>
              <Select
                value={selectedTemplateId}
                onChange={(templateId) => {
                  setError(undefined);
                  setSelectedTemplateId(templateId);
                }}
                options={templates.data.items.map(templateOption)}
                disabled={pending}
              />
            </label>
          ) : null}
          {versions.isLoading ? <Spin /> : null}
          {versions.isError ? (
            <QueryFailure
              title="加载模板版本失败"
              error={versions.error}
              onRetry={() => void versions.refetch()}
            />
          ) : null}
          {versionUnavailable ? (
            <QueryFailure
              title="当前发布版本不可用"
              error={new Error("未找到与所选模板当前版本一致的发布版本。")}
              onRetry={() => void versions.refetch()}
            />
          ) : null}
          {selectedVersion ? <TemplatePreview version={selectedVersion} /> : null}
        </div>
      </Modal>
    </section>
  );
}

function TemplatePreview({ version }: { version: BusinessTemplateVersion }) {
  const objects = version.configuration.objects.filter(
    (object) => object.status === "ACTIVE",
  );
  const names = objects.map((object) => object.name);

  return (
    <div className={styles.templatePreview}>
      <Alert
        type="info"
        showIcon
        title="将创建对象草稿，不会直接上线"
        description="公司管理员需要审核、调整并发布这些对象草稿后，员工才能使用。"
      />
      <dl className={styles.applicationLedger}>
        <div>
          <dt>当前版本</dt>
          <dd>当前版本：v{version.versionNo}</dd>
        </div>
        <div>
          <dt>业务对象</dt>
          <dd>包含 {objects.length} 个业务对象</dd>
        </div>
        <div>
          <dt>对象名称</dt>
          <dd>{names.join("、") || "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

function QueryFailure({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const apiError = toApiError(error);

  return (
    <Alert
      type="error"
      showIcon
      title={title}
      description={
        <>
          <p>
            {apiError.message}（请求编号：{apiError.requestId}）
          </p>
          <Button size="small" onClick={onRetry}>
            重试
          </Button>
        </>
      }
    />
  );
}

function ApplicationResult({ result }: { result: TemplateApplication }) {
  return (
    <div className={styles.applicationResult} role="status">
      <strong>已生成 {result.objects.length} 个对象草稿</strong>
      <p>来源模板版本：{result.templateName} v{result.templateVersionNo}</p>
      <ul className={styles.generatedObjectList}>
        {result.objects.map((object) => (
          <li key={object.objectId}>
            {object.name}（{object.code}）
          </li>
        ))}
      </ul>
      <p>请由公司管理员审核、调整并发布这些对象草稿。</p>
    </div>
  );
}

function templateOption(template: BusinessTemplate) {
  return {
    value: template.id,
    label: `${template.name} · v${template.activeVersion?.versionNo ?? "—"}`,
  };
}

function blockingReasonText(
  reason: TenantBusinessConfigurationSummary["blockingReason"],
) {
  switch (reason) {
    case "TARGET_NOT_EMPTY":
      return "公司已有业务对象，不能使用初始化模板。";
    case "TENANT_NOT_DRAFT":
      return "只有草稿状态的公司可以使用初始化模板。";
    default:
      return "当前公司暂时不能使用初始化模板。";
  }
}
