"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Empty,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useState } from "react";

import { ObjectIcon } from "@/components/navigation/object-icon";
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

  const columns: ColumnsType<ObjectDraft> = [
    {
      title: "业务表",
      key: "object",
      width: 160,
      render: (_, row) => (
        <Link
          className={styles.ledgerName}
          href={`/workspace/${tenantCode}/settings/objects/${row.object.id}`}
        >
          <span className={styles.ledgerIcon}>
            <ObjectIcon name={row.object.icon} />
          </span>
          {row.object.name}
        </Link>
      ),
    },
    {
      title: "业务表代码",
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
        <Tag color={objectStatusColor(row)}>
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
      width: 132,
      render: (_, row) => (
        <div className={styles.ledgerOrder}>
          <Button
            size="small"
            type="text"
            aria-label={`上移 ${row.object.name}`}
            disabled={
              row.object.status === "ARCHIVED" ||
              editable.findIndex((item) => item.object.id === row.object.id) ===
                0 ||
              reorder.isPending
            }
            onClick={() => move(row.object.id, -1)}
          >
            上移
          </Button>
          <Button
            size="small"
            type="text"
            aria-label={`下移 ${row.object.name}`}
            disabled={
              row.object.status === "ARCHIVED" ||
              editable.findIndex((item) => item.object.id === row.object.id) ===
                editable.length - 1 ||
              reorder.isPending
            }
            onClick={() => move(row.object.id, 1)}
          >
            下移
          </Button>
        </div>
      ),
    },
    {
      title: "停用与恢复",
      key: "lifecycle",
      fixed: "right",
      width: 140,
      render: (_, row) => (
        <ObjectLifecycleControl
          tenantCode={tenantCode}
          draft={row}
          api={api}
          labelled
          onChanged={(next) => clientAccept(next)}
        />
      ),
    },
  ];

  function clientAccept(next: ObjectDraft) {
    queryClient.setQueryData<ObjectDraft[]>(queryKey, (current) =>
      current?.map((row) => (row.object.id === next.object.id ? next : row)),
    );
  }

  if (rows.length === 0) {
    return (
      <section className={styles.panel}>
        <Empty
          description={
            <Space orientation="vertical">
              <span>还没有业务表。</span>
              <Typography.Text type="secondary">
                一张业务表对应一类业务数据，例如获客、跟单或客户；创建后可以继续添加字段、配置列表和员工权限。
              </Typography.Text>
            </Space>
          }
        >
          <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
            <Button type="primary">创建第一张业务表</Button>
          </Link>
        </Empty>
      </section>
    );
  }

  return (
    <section>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      <div className={styles.sectionHeading}>
        <h2>业务表 {rows.length}</h2>
        <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
          <Button type="primary">新建业务表</Button>
        </Link>
      </div>
      <Radio.Group
        aria-label="业务表状态筛选"
        value={filter}
        onChange={(event) => setFilter(event.target.value as string)}
        optionType="button"
        options={[
          { label: "全部", value: "ALL" },
          { label: "使用中", value: "ACTIVE" },
          { label: "已停用", value: "ARCHIVED" },
          { label: "未发布", value: "DRAFT" },
        ]}
      />
      <Table
        className={styles.ledger}
        rowKey={(row) => row.object.id}
        size="small"
        columns={columns}
        dataSource={visible}
        pagination={false}
        // Narrow screens scroll the ledger sideways instead of stacking names
        // one character per line.
        scroll={{ x: "max-content" }}
        loading={drafts.isFetching}
        aria-label="业务表列表"
      />
    </section>
  );
}

function objectStatusColor(
  draft: ObjectDraft,
): "blue" | "gold" | "green" | undefined {
  if (draft.object.status === "ARCHIVED") return undefined;
  if (draft.object.publicationNumber === null) return "blue";
  return draft.object.hasUnpublishedChanges ? "gold" : "green";
}
