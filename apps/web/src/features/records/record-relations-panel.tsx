"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Popconfirm, Select, Space } from "antd";
import { relationRequest } from "@/lib/api/relation-request";
import { toApiError } from "@/lib/api/api-error";
import { objectApi } from "@/features/objects/object-api";
import { recordApi } from "./record-api";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";
import styles from "./record-relations.module.css";
export function RecordRelationsPanel({
  tenantCode,
  objectCode,
  recordId,
  canUpdate,
}: {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  canUpdate: boolean;
}) {
  const client = useQueryClient();
  const path = `/api/v1/workspaces/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(objectCode)}/records/${encodeURIComponent(recordId)}/relations`;
  const [targetObject, setTargetObject] = useState<string>();
  const [targetId, setTargetId] = useState<string>();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const links = useQuery({
    queryKey: ["relations", tenantCode, objectCode, recordId],
    queryFn: () =>
      relationRequest<
        Array<{
          id: string;
          recordId: string;
          objectCode: string;
          title: string;
        }>
      >(path),
  });
  const objects = useQuery({
    queryKey: ["workspace", tenantCode, "relation-objects"],
    queryFn: () => objectApi.listAccessible(tenantCode),
    enabled: canUpdate,
  });
  const records = useQuery({
    queryKey: ["relation-targets", tenantCode, targetObject, debouncedSearch],
    queryFn: () =>
      recordApi.list(tenantCode, targetObject!, {
        ...DEFAULT_RECORD_QUERY,
        search: debouncedSearch || undefined,
      }),
    enabled: canUpdate && !!targetObject,
  });
  const mutation = useMutation({
    mutationFn: (id?: string) =>
      relationRequest(
        path + (id ? `/${id}` : ""),
        id ? "DELETE" : "POST",
        id ? undefined : { objectCode: targetObject, recordId: targetId },
      ),
    onSuccess: () => {
      setTargetId(undefined);
      void client.invalidateQueries({ queryKey: ["relations"] });
    },
  });
  return (
    <section className={styles.panel} aria-label="关联业务记录">
      <h2>关联业务记录</h2>
      {(links.error || mutation.error) && (
        <Alert
          type="error"
          title={toApiError(links.error || mutation.error).message}
        />
      )}
      {links.data?.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未关联其他记录"
        />
      )}
      {(objects.error || records.error) && (
        <Alert
          type="error"
          title="关联记录搜索失败"
          description={toApiError(objects.error || records.error).message}
        />
      )}
      <ul className={styles.list}>
        {links.data?.map((link) => (
          <li key={link.id}>
            <Space>
              <Link
                href={`/workspace/${tenantCode}/objects/${link.objectCode}/${link.recordId}`}
              >
                {link.title}
              </Link>
              {canUpdate && (
                <Popconfirm
                  title="解除这条关联？"
                  onConfirm={() => mutation.mutate(link.id)}
                >
                  <Button size="small" loading={mutation.isPending}>
                    解除关联
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </li>
        ))}
      </ul>
      {canUpdate && (
        <div className={styles.controls}>
          <Select
            aria-label="关联业务表"
            placeholder="选择业务表"
            style={{ width: "100%" }}
            value={targetObject}
            options={objects.data?.map((o) => ({
              label: o.name,
              value: o.code,
            }))}
            onChange={(v) => {
              setTargetObject(v);
              setTargetId(undefined);
            }}
          />
          <Input
            aria-label="搜索关联记录"
            placeholder="搜索记录"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setTargetId(undefined);
            }}
          />
          <Select
            aria-label="关联记录"
            placeholder="选择可见记录"
            style={{ width: "100%" }}
            value={targetId}
            loading={records.isFetching}
            options={records.data?.items
              .filter((r) => r.id !== recordId)
              .map((r) => ({ label: r.title, value: r.id }))}
            onChange={setTargetId}
          />
          <Button
            disabled={!targetId}
            loading={mutation.isPending}
            onClick={() => mutation.mutate(undefined)}
          >
            添加关联
          </Button>
        </div>
      )}
    </section>
  );
}
