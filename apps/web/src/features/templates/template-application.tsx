"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Select, Spin } from "antd";
import Link from "next/link";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";
import { ReadingPanel } from "@/components/workbench/surface";

import { browserTemplateApi, type TemplateApi } from "./template-api";
import type {
  BusinessTemplate,
  BusinessTemplatePage,
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
  const templateListKey = [
    "business-templates",
    "applicable",
    tenant.id,
  ] as const;

  const templates = useQuery({
    queryKey: templateListKey,
    queryFn: () => listApplicableTemplates(api),
    enabled: open,
  });
  const effectiveTemplateId =
    selectedTemplateId ?? templates.data?.items[0]?.id;

  const selectedTemplate = templates.data?.items.find(
    (template) => template.id === effectiveTemplateId,
  );
  const versionKey = [
    "business-template",
    effectiveTemplateId,
    "versions",
  ] as const;
  const versions = useQuery({
    queryKey: versionKey,
    queryFn: () => api.listVersions(effectiveTemplateId!),
    enabled: open && Boolean(effectiveTemplateId),
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
    if (effectiveTemplateId) {
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
    <ReadingPanel
      ariaLabel="初始化业务表"
      className={styles.applicationPanel}
    >
      <div className={styles.applicationHeading}>
        <div>
          <h2>初始化业务表</h2>
          <p>
            {summary.objectCount === 0
              ? "模板只是加速器。可以现在应用一套已发布模板，也可以暂不使用，等公司启用后由管理员手工创建。"
              : `当前公司已有 ${summary.objectCount} 张业务表。`}
          </p>
        </div>
      </div>

      {summary.canApplyTemplate ? (
        <div className={styles.applicationChoices}>
          <button
            type="button"
            className={styles.applicationChoice}
            onClick={() => setOpen(true)}
          >
            <strong>应用业务模板</strong>
            <span>一次生成模板中的全部业务表草稿。公司管理员仍需审核并发布。</span>
          </button>
          <div className={styles.applicationChoice}>
            <strong>暂不使用模板</strong>
            <span>
              启用公司后，由公司管理员在设置中创建第一张业务表。这不是权限错误。
            </span>
          </div>
        </div>
      ) : null}

      {displayedResult ? <ApplicationResult result={displayedResult} /> : null}
      {!displayedResult && !summary.canApplyTemplate ? (
        <p className={styles.applicationBlocked}>
          {blockingReasonText(summary.blockingReason, tenant.status)}
          {tenant.status === "ACTIVE" && summary.objectCount === 0 ? (
            <>
              {" "}
              公司管理员可在工作空间设置中
              <Link href={`/workspace/${tenant.code}/settings/objects/new`}>
                创建第一张业务表
              </Link>
              。
            </>
          ) : null}
        </p>
      ) : null}

      <Modal
        title="为公司创建业务表"
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
              application.mutate({
                template: selectedTemplate,
                version: selectedVersion,
              })
            }
          >
            确认应用
          </Button>,
        ]}
      >
        <div className={styles.applicationModalContent}>
          <p className={styles.applicationIntro}>
            为 {tenant.name}{" "}
            选择一套已发布的表方案。确认后会一次创建方案中的全部启用业务表，权限和发布由公司管理员继续完成。
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
            <p className={styles.applicationBlocked}>
              没有可应用的已发布模板。
            </p>
          ) : null}
          {templates.data?.items.length ? (
            <label className={styles.templateSelectLabel}>
              <span>选择模板</span>
              <Select
                value={effectiveTemplateId}
                showSearch
                optionFilterProp="label"
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
          {selectedVersion ? (
            <TemplatePreview version={selectedVersion} />
          ) : null}
        </div>
      </Modal>
    </ReadingPanel>
  );
}

async function listApplicableTemplates(
  api: TemplateApi,
): Promise<BusinessTemplatePage> {
  const limit = 20;
  const first = await api.list({ page: 1, limit, hasActiveVersion: true });
  const items = [...first.items];
  let page = first.page;
  let lastPageSize = first.items.length;
  let total = first.total;

  while (items.length < total && lastPageSize === limit) {
    page += 1;
    const next = await api.list({
      page,
      limit,
      hasActiveVersion: true,
    });
    items.push(...next.items);
    lastPageSize = next.items.length;
    total = next.total;
  }

  return { ...first, items, total };
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
      <p>
        来源模板版本：{result.templateName} v{result.templateVersionNo}
      </p>
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
  tenantStatus: TenantBusinessConfigurationTarget["status"],
) {
  switch (reason) {
    case "TARGET_NOT_EMPTY":
      return "公司已有业务表，不能再用模板覆盖初始化。";
    case "TENANT_NOT_DRAFT":
      return tenantStatus === "ACTIVE"
        ? "公司已启用。模板只能用于尚未初始化的草稿公司；现在应由公司管理员手工创建业务表。"
        : "只有草稿状态的公司可以使用初始化模板。";
    default:
      return "当前公司暂时不能使用初始化模板。";
  }
}
