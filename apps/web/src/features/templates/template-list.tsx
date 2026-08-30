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
    title: "模板名称",
    dataIndex: "name",
    render: (name: string, template) => (
      <Link
        className={styles.templateLink}
        href={`/platform/templates/${template.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        {name}
      </Link>
    ),
  },
  { title: "模板代码", dataIndex: "code", className: styles.code },
  {
    title: "状态",
    dataIndex: "status",
    render: (status: BusinessTemplate["status"]) => (
      <TemplateStatus status={status} />
    ),
  },
  { title: "对象数", dataIndex: "objectCount" },
  {
    title: "当前版本",
    render: (_, template) =>
      template.activeVersion ? `v${template.activeVersion.versionNo}` : "—",
  },
  { title: "已应用公司", dataIndex: "applicationCount" },
  {
    title: "更新时间",
    dataIndex: "updatedAt",
    render: (value?: string) => formatDate(value),
  },
];

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
        scroll={{ x: 860 }}
        pagination={{
          current: data.page,
          pageSize: data.limit,
          total: data.total,
          showSizeChanger: false,
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
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
