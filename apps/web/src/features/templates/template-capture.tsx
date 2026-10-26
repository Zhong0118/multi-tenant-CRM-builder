"use client";

import { CopyOutlined, NodeIndexOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Pagination,
  Spin,
  Tag,
} from "antd";
import { useState } from "react";

import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { toApiError } from "@/lib/api/api-error";
import type { TemplateApi } from "./template-api";
import type {
  BusinessTemplateDetail,
  TemplateCapturePreview,
} from "./template-types";
import styles from "./templates.module.css";

interface Props {
  templateId: string;
  expectedVersion: number;
  api: TemplateApi;
  onApply: (configuration: BusinessTemplateDetail["configuration"]) => void;
  onClose: () => void;
}

export function TemplateCapture({
  templateId,
  expectedVersion,
  api,
  onApply,
  onClose,
}: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sourceId, setSourceId] = useState<string>();
  const [preview, setPreview] = useState<TemplateCapturePreview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const sources = useQuery({
    queryKey: [
      "platform",
      "template-capture-sources",
      templateId,
      search,
      page,
    ],
    queryFn: () =>
      api.listSourceTenants({ page, ...(search ? { search } : {}) }),
  });

  function clearPreview() {
    setSourceId(undefined);
    setPreview(undefined);
    setError(undefined);
  }
  async function readPreview() {
    if (!sourceId || loading) return;
    setLoading(true);
    setError(undefined);
    setPreview(undefined);
    try {
      setPreview(
        await api.capturePreview(templateId, {
          expectedVersion,
          sourceTenantId: sourceId,
        }),
      );
    } catch (caught) {
      const failure = toApiError(caught);
      setError(`${failure.message}（请求编号：${failure.requestId}）`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      title="从公司复制流程"
      width={OVERLAY_SIZE.wide}
      onCancel={onClose}
      maskClosable={!loading}
      closable={!loading}
      keyboard={!loading}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={loading}>
          取消
        </Button>,
        <Button
          key="apply"
          type="primary"
          icon={<CopyOutlined aria-hidden />}
          disabled={
            !preview ||
            loading ||
            preview.blocking.length > 0 ||
            preview.summary.objects.length === 0
          }
          onClick={() => {
            if (preview && preview.blocking.length === 0)
              onApply(preview.configuration);
          }}
        >
          替换本地模板草稿
        </Button>,
      ]}
    >
      <div className={styles.captureBody}>
        <p className={styles.applicationIntro}>
          复制已发布的表、字段、状态流程、跨表规则，以及当前公海和全体员工目标。现有工作台模板保留，客户数据和人员不会复制。
        </p>
        <Input.Search
          aria-label="搜索来源公司"
          placeholder="搜索公司名称或代码"
          enterButton="搜索"
          disabled={loading}
          onSearch={(value) => {
            setSearch(value.trim());
            setPage(1);
            clearPreview();
          }}
        />
        {sources.isError ? (
          <Alert
            type="error"
            showIcon
            title="公司列表加载失败"
            description={toApiError(sources.error).message}
            action={
              <Button onClick={() => void sources.refetch()}>重试</Button>
            }
          />
        ) : sources.isPending ? (
          <Spin aria-label="加载来源公司" />
        ) : (
          <>
            <div
              className={styles.sourceCompanies}
              role="radiogroup"
              aria-label="来源公司"
            >
              {sources.data?.items.map((tenant) => (
                <label
                  className={styles.sourceCompany}
                  key={tenant.id}
                  data-selected={sourceId === tenant.id}
                >
                  <input
                    type="radio"
                    name="capture-source"
                    value={tenant.id}
                    checked={sourceId === tenant.id}
                    disabled={loading}
                    onChange={() => {
                      setSourceId(tenant.id);
                      setPreview(undefined);
                      setError(undefined);
                    }}
                  />
                  <span>
                    <strong>{tenant.name}</strong>
                    <small>{tenant.code}</small>
                  </span>
                </label>
              ))}
              {sources.data?.items.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="没有匹配的已启用公司"
                />
              ) : null}
            </div>
            <Pagination
              size="small"
              current={page}
              pageSize={20}
              total={sources.data?.total ?? 0}
              hideOnSinglePage
              showSizeChanger={false}
              disabled={loading}
              onChange={(next) => {
                setPage(next);
                clearPreview();
              }}
            />
          </>
        )}
        <Button
          icon={<NodeIndexOutlined aria-hidden />}
          loading={loading}
          disabled={!sourceId || sources.isFetching}
          onClick={() => void readPreview()}
        >
          读取流程预览
        </Button>
        {error ? (
          <Alert type="error" showIcon title="预览未生成" description={error} />
        ) : null}
        {preview ? (
          <section
            className={styles.capturePreview}
            aria-label="待复制流程摘要"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2>{preview.sourceTenant.name}</h2>
                <p>
                  {preview.summary.objects.length} 张业务表 ·{" "}
                  {preview.summary.goalRuleCount} 项全体员工目标
                </p>
              </div>
            </div>
            <div className={styles.flowObjectList}>
              {preview.summary.objects.map((object) => (
                <article key={object.id} className={styles.flowObject}>
                  <strong>{object.name}</strong>
                  <code>{object.code}</code>
                  <div>
                    <Tag>{object.fieldCount} 个字段</Tag>
                    <Tag>{object.stateCount} 个状态</Tag>
                    <Tag>{object.automationCount} 条规则</Tag>
                    {object.poolEnabled ? (
                      <Tag color="blue">公海已启用</Tag>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <p className={styles.captureExclusions}>
              未复制：未发布业务表 {preview.excluded.unpublishedObjects}{" "}
              张、成员例外权限 {preview.excluded.memberOverrides}{" "}
              项、指定员工目标 {preview.excluded.selectedGoalRules} 项
            </p>
            {preview.warnings.map((issue, index) => (
              <Alert
                key={`${issue.code}-${index}`}
                type="warning"
                showIcon
                title={issue.message}
              />
            ))}
            {preview.blocking.length ? (
              <Alert
                type="error"
                showIcon
                title="以下配置需要先在来源公司调整"
                description={
                  <ul className={styles.captureIssues}>
                    {preview.blocking.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        <span>{issue.message}</span>
                        {issue.path ? <code>{issue.path}</code> : null}
                      </li>
                    ))}
                  </ul>
                }
              />
            ) : null}
            <Alert
              type="info"
              showIcon
              title="确认后将替换当前模板的业务表草稿"
              description="替换后请检查并保存草稿，再发布模板。已经使用旧版本的公司不会自动变更。"
            />
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
