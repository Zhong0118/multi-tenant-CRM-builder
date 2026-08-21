"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";

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
  const [error, setError] = useState<string>();
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

  function move(objectId: string, direction: -1 | 1) {
    const ordered = [...rows];
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

  const columns: ColumnsType<ObjectDraft> = [
    {
      title: "业务对象",
      key: "object",
      render: (_, row) => (
        <Link
          className={styles.ledgerName}
          href={`/workspace/${tenantCode}/settings/objects/${row.object.id}`}
        >
          {row.object.name}
        </Link>
      ),
    },
    {
      title: "对象代码",
      key: "code",
      width: 180,
      render: (_, row) => (
        <span className={styles.stableKey}>{row.object.code}</span>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_, row) => (
        <Tag color={row.object.hasUnpublishedChanges ? "gold" : undefined}>
          {objectStatusLabel(row.object)}
        </Tag>
      ),
    },
    {
      title: "字段",
      key: "fields",
      width: 72,
      align: "right",
      render: (_, row) => row.fields.length,
    },
    {
      title: "当前版本",
      key: "publication",
      width: 100,
      render: (_, row) =>
        row.object.publicationNumber === null ? (
          <span className={styles.ledgerMuted}>未发布</span>
        ) : (
          <span className={styles.stableKey}>
            v{row.object.publicationNumber}
          </span>
        ),
    },
    {
      title: "记录",
      key: "records",
      width: 80,
      align: "right",
      render: (_, row) => row.activeRecordCount,
    },
    {
      title: "导航顺序",
      key: "order",
      width: 96,
      render: (_, row, index) => (
        <div className={styles.ledgerOrder}>
          <Button
            size="small"
            type="text"
            aria-label={`上移 ${row.object.name}`}
            disabled={index === 0 || reorder.isPending}
            onClick={() => move(row.object.id, -1)}
          >
            ↑
          </Button>
          <Button
            size="small"
            type="text"
            aria-label={`下移 ${row.object.name}`}
            disabled={index === rows.length - 1 || reorder.isPending}
            onClick={() => move(row.object.id, 1)}
          >
            ↓
          </Button>
        </div>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <section className={styles.panel}>
        <Empty
          description={
            <Space orientation="vertical">
              <span>还没有业务对象。</span>
              <Typography.Text type="secondary">
                业务对象决定员工能录入和查询哪些数据，例如获客、跟单或客户。
              </Typography.Text>
            </Space>
          }
        >
          <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
            <Button type="primary">创建第一个业务对象</Button>
          </Link>
        </Empty>
      </section>
    );
  }

  return (
    <section>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <div className={styles.sectionHeading}>
        <h2>业务对象 {rows.length}</h2>
        <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
          <Button type="primary">新建业务对象</Button>
        </Link>
      </div>
      <Table
        className={styles.ledger}
        rowKey={(row) => row.object.id}
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        loading={drafts.isFetching}
        aria-label="业务对象列表"
      />
    </section>
  );
}
