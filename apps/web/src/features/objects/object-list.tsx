"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  EllipsisOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dropdown, Empty, Segmented, Table, Typography } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Page, PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { ObjectIcon } from "@/components/navigation/object-icon";
import { StatusTag } from "@/components/workbench/status-tag";
import { toApiError } from "@/lib/api/api-error";

import { ObjectLifecycleControl } from "./object-lifecycle-control";
import { objectApi as defaultObjectApi, type ObjectApi } from "./object-api";
import { objectStatusLabel, type ObjectDraft } from "./object-types";

import styles from "./objects.module.css";

export interface ObjectListProps {
  tenantCode: string;
  initialDrafts: ObjectDraft[];
  api?: ObjectApi;
}

export function ObjectList({
  tenantCode,
  initialDrafts,
  api = defaultObjectApi,
}: ObjectListProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("ALL");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [lifecycle, setLifecycle] = useState<ObjectDraft>();
  const router = useRouter();
  const queryKey = ["workspace", tenantCode, "object-definitions"] as const;
  const drafts = useQuery({
    queryKey,
    queryFn: () => api.listDrafts(tenantCode),
    initialData: initialDrafts,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const reorder = useMutation({
    mutationFn: (items: Array<{ objectId: string; expectedVersion: number }>) =>
      api.reorderObjects(tenantCode, items),
    onMutate: () => setError(undefined),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey, exact: false }),
    onError: (caught) => {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    },
  });

  const rows = drafts.data ?? [];

  const editable = rows.filter((row) => row.object.status !== "ARCHIVED");
  const visible = rows.filter(
    (row) =>
      filter === "ALL" ||
      (filter === "DRAFT"
        ? row.object.publicationNumber === null &&
          row.object.status !== "ARCHIVED"
        : row.object.status === filter),
  );

  function move(objectId: string, direction: -1 | 1) {
    const ordered = [...editable];
    const from = ordered.findIndex((row) => row.object.id === objectId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    reorder.mutate(
      ordered.map((row) => ({
        objectId: row.object.id,
        expectedVersion: row.object.version,
      })),
    );
  }

  const position = (row: ObjectDraft) =>
    editable.findIndex((item) => item.object.id === row.object.id);
  const designerHref = (row: ObjectDraft) =>
    `/workspace/${tenantCode}/settings/objects/${row.object.id}`;

  const columns: ColumnsType<ObjectDraft> = [
    {
      title: "业务表",
      key: "object",
      render: (_, row) => (
        <Link className={styles.tableName} href={designerHref(row)}>
          <span className={styles.ledgerIcon}>
            <ObjectIcon name={row.object.icon} />
          </span>
          <span className={styles.tableNameText}>
            <strong>{row.object.name}</strong>
            <span className={styles.stableKey}>{row.object.code}</span>
          </span>
        </Link>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, row) => (
        <StatusTag tone={objectStatusTone(row)}>{objectStatusText(row)}</StatusTag>
      ),
    },
    {
      title: "字段",
      key: "fields",
      width: 80,
      align: "right",
      render: (_, row) => row.fields.length,
    },
    {
      title: "记录",
      key: "records",
      width: 96,
      align: "right",
      render: (_, row) => row.activeRecordCount,
    },
    {
      title: "已发布",
      key: "publication",
      width: 96,
      render: (_, row) =>
        row.object.publicationNumber === null ? (
          <span className={styles.ledgerMuted}>—</span>
        ) : (
          <span className={styles.stableKey}>v{row.object.publicationNumber}</span>
        ),
    },
    {
      title: <span className={styles.visuallyHidden}>操作</span>,
      key: "actions",
      width: 56,
      align: "center",
      render: (_, row) => {
        const index = position(row);
        const archived = row.object.status === "ARCHIVED";
        const items: MenuProps["items"] = [
          { key: "open", label: "打开设计器", onClick: () => router.push(designerHref(row)) },
          { type: "divider" },
          {
            key: "up",
            label: "在导航中上移",
            icon: <ArrowUpOutlined aria-hidden />,
            disabled: archived || index <= 0 || reorder.isPending,
            onClick: () => move(row.object.id, -1),
          },
          {
            key: "down",
            label: "在导航中下移",
            icon: <ArrowDownOutlined aria-hidden />,
            disabled: archived || index === editable.length - 1 || reorder.isPending,
            onClick: () => move(row.object.id, 1),
          },
          ...(row.object.publicationNumber !== null
            ? [
                { type: "divider" as const },
                archived
                  ? { key: "restore", label: "恢复业务表", onClick: () => setLifecycle(row) }
                  : { key: "archive", label: "停用业务表", danger: true, onClick: () => setLifecycle(row) },
              ]
            : []),
        ];
        return (
          <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items }}>
            <Button
              type="text"
              size="small"
              aria-label={`更多操作 ${row.object.name}`}
              icon={<EllipsisOutlined aria-hidden />}
            />
          </Dropdown>
        );
      },
    },
  ];

  function clientAccept(next: ObjectDraft) {
    queryClient.setQueryData<ObjectDraft[]>(queryKey, (current) =>
      current?.map((row) => (row.object.id === next.object.id ? next : row)),
    );
  }

  const newButton = (
    <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
      <Button type="primary" icon={<PlusOutlined aria-hidden />}>
        新建业务表
      </Button>
    </Link>
  );
  const counts = {
    ALL: rows.length,
    ACTIVE: rows.filter((row) => row.object.status === "ACTIVE").length,
    DRAFT: rows.filter((row) => row.object.publicationNumber === null && row.object.status !== "ARCHIVED").length,
    ARCHIVED: rows.filter((row) => row.object.status === "ARCHIVED").length,
  };

  return (
    <Page width="settings">
      <PageHeader
        title="业务表"
        count={rows.length}
        description="字段、列表和权限的改动先存为草稿，发布后员工才看到；停用与恢复立即生效。"
        extra={newButton}
      />
      {error ? <Alert type="error" showIcon title={error} className={styles.listAlert} /> : null}
      {notice ? (
        <Alert type="success" showIcon closable title={notice} onClose={() => setNotice(undefined)} className={styles.listAlert} />
      ) : null}
      {rows.length === 0 ? (
        <Empty
          className={styles.listEmpty}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              还没有业务表。
              <br />
              <Typography.Text type="secondary">
                一张业务表对应一类业务数据，例如获客、跟单或客户。
              </Typography.Text>
            </>
          }
        >
          <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
            <Button type="primary">创建第一张业务表</Button>
          </Link>
        </Empty>
      ) : (
        <>
          <PageToolbar
            start={
              <Segmented
                aria-label="业务表状态筛选"
                value={filter}
                onChange={(value) => setFilter(String(value))}
                options={[
                  { label: `全部 ${counts.ALL}`, value: "ALL" },
                  { label: `使用中 ${counts.ACTIVE}`, value: "ACTIVE" },
                  { label: `未发布 ${counts.DRAFT}`, value: "DRAFT" },
                  { label: `已停用 ${counts.ARCHIVED}`, value: "ARCHIVED" },
                ]}
              />
            }
          />
          <Table
            className={styles.ledger}
            rowKey={(row) => row.object.id}
            rowClassName={(row) => (row.object.status === "ARCHIVED" ? styles.archivedRow : "")}
            columns={columns}
            dataSource={visible}
            pagination={false}
            scroll={{ x: 640 }}
            loading={drafts.isFetching}
            aria-label="业务表列表"
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的业务表" /> }}
          />
        </>
      )}
      {lifecycle ? (
        <ObjectLifecycleControl
          key={lifecycle.object.id}
          tenantCode={tenantCode}
          draft={lifecycle}
          api={api}
          autoStart
          onClose={() => setLifecycle(undefined)}
          onChanged={(next) => {
            clientAccept(next);
            setNotice(
              next.object.status === "ARCHIVED"
                ? `「${next.object.name}」已停用，配置和历史数据已保留`
                : `「${next.object.name}」已恢复，沿用原发布版本，草稿未发布`,
            );
          }}
        />
      ) : null}
    </Page>
  );
}

function objectStatusTone(draft: ObjectDraft): "neutral" | "info" | "warning" | "success" {
  if (draft.object.status === "ARCHIVED") return "neutral";
  if (draft.object.publicationNumber === null) return "info";
  return draft.object.hasUnpublishedChanges ? "warning" : "success";
}

function objectStatusText(draft: ObjectDraft): string {
  if (draft.object.status !== "ARCHIVED" && draft.object.publicationNumber !== null && draft.object.hasUnpublishedChanges) {
    return "有待发布改动";
  }
  return objectStatusLabel(draft.object);
}
