"use client";

import { Button, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { StatePanel } from "@/components/workbench/state-panel";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel } from "@/components/workbench/surface";

import type { BusinessTemplate, BusinessTemplatePage } from "./template-types";
import styles from "./templates.module.css";

const columns: ColumnsType<BusinessTemplate> = [
  {
    title: "模板",
    dataIndex: "name",
    render: (name: string, template) => (
      <span className={styles.templateName}>
        <Link
          className={styles.templateLink}
          href={`/platform/templates/${template.id}`}
          onClick={(event) => event.stopPropagation()}
        >
          {name}
        </Link>
        <code>{template.code}</code>
      </span>
    ),
  },
  {
    title: "状态",
    dataIndex: "status",
    render: (_, template) => (
      <span className={styles.templateState}>
        <TemplateStatus status={template.status} />
        <small>{templateStateHint(template)}</small>
      </span>
    ),
  },
  {
    title: "内容",
    render: (_, template) =>
      `${template.objectCount} 张业务表 · ${template.fieldCount} 个字段`,
  },
  {
    title: "已应用公司",
    dataIndex: "applicationCount",
    width: 112,
    render: (count: number) => (count ? `${count} 家` : "未应用"),
  },
  {
    title: "更新时间",
    dataIndex: "updatedAt",
    width: 120,
    render: (value?: string) => formatDate(value),
  },
];

/** What the state means for companies, the thing an operator acts on. */
export function templateStateHint(template: BusinessTemplate): string {
  const live = template.activeVersion
    ? `公司可用 v${template.activeVersion.versionNo}`
    : null;
  switch (template.status) {
    case "DRAFT":
      return "尚未发布，公司不可用";
    case "CHANGED":
      return live ? `草稿有改动，${live}` : "草稿有改动，尚未发布";
    case "ARCHIVED":
      return "不再提供给新公司";
    default:
      return live ?? "已发布";
  }
}

export function TemplateList({
  data,
  navigate,
}: {
  data: BusinessTemplatePage;
  navigate?: (path: string) => void;
}) {
  const router = useRouter();
  const go = navigate ?? router.push;
  const createLink = (
    <Link href="/platform/templates/new">
      <Button type="primary">新建模板</Button>
    </Link>
  );

  if (data.items.length === 0) {
    return (
      <StatePanel
        title="还没有业务模板"
        description="创建第一个模板，集中配置可复用的业务对象。"
        action={createLink}
      />
    );
  }

  return (
    <DataPanel ariaLabel="业务模板列表" className={styles.templateTable}>
      <Table
        columns={columns}
        dataSource={data.items}
        rowKey="id"
        scroll={{ x: 820 }}
        pagination={{
          current: data.page,
          pageSize: data.limit,
          total: data.total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          showTotal: (total) => `共 ${total} 个模板`,
          onChange: (page) => go(`/platform/templates?page=${page}`),
        }}
        onRow={(template) => ({
          onClick: () => go(`/platform/templates/${template.id}`),
        })}
      />
    </DataPanel>
  );
}

function TemplateStatus({ status }: { status: BusinessTemplate["status"] }) {
  const labels: Record<BusinessTemplate["status"], string> = {
    DRAFT: "草稿",
    PUBLISHED: "已发布",
    CHANGED: "有未发布变更",
    ARCHIVED: "已归档",
  };
  const tones = {
    DRAFT: "neutral",
    PUBLISHED: "success",
    CHANGED: "warning",
    ARCHIVED: "neutral",
  } as const;
  return <StatusTag tone={tones[status]}>{labels[status]}</StatusTag>;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
