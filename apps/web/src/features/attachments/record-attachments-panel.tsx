"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Popconfirm, Upload } from "antd";
import { PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { browserApiOrigin } from "@/lib/api/api-origin";
import styles from "./attachments.module.css";
interface Attachment {
  id: string;
  filename: string;
  byteSize: number;
  createdAt: string;
}
async function checked(response: Response) {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body as {
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(
      error?.error?.message ??
        error?.message ??
        `附件操作失败（${response.status}）`,
    );
  }
  return response;
}
export function RecordAttachmentsPanel({
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
  const base = `${browserApiOrigin()}/api/v1/workspaces/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(objectCode)}/records/${recordId}/attachments`;
  const client = useQueryClient();
  const key = ["attachments", tenantCode, objectCode, recordId];
  const [error, setError] = useState<string>();
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await checked(await fetch(base, { credentials: "include" }));
      return (await r.json()) as Attachment[];
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: { file?: File; remove?: string }) => {
      const body = new FormData();
      if (input.file) body.append("file", input.file);
      await checked(
        await fetch(input.remove ? `${base}/${input.remove}` : base, {
          method: input.remove ? "DELETE" : "POST",
          credentials: "include",
          ...(input.file ? { body } : {}),
        }),
      );
    },
    onSuccess: () => {
      setError(undefined);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => setError(e.message),
  });
  async function download(item: Attachment) {
    try {
      const r = await checked(
        await fetch(`${base}/${item.id}`, { credentials: "include" }),
      );
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    }
  }
  return (
    <section className={styles.panel} aria-label="记录附件">
      <header className={styles.heading}>
        <h2>
          <PaperClipOutlined /> 附件
        </h2>
        {canUpdate && (
          <Upload
            showUploadList={false}
            accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx"
            beforeUpload={(file) => {
              if (file.size === 0 || file.size > 5 * 1024 * 1024) {
                setError("单个文件需大于 0 且不超过 5 MB");
                return false;
              }
              mutation.mutate({ file });
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={mutation.isPending}>
              上传附件
            </Button>
          </Upload>
        )}
      </header>
      <p className={styles.hint}>
        每条记录最多 10 个文件，单个 5 MB；附件随记录权限开放。
      </p>
      {error && (
        <Alert
          type="error"
          title={error}
          closable
          onClose={() => setError(undefined)}
        />
      )}
      {query.isError && (
        <Alert
          type="error"
          title="附件加载失败"
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      {query.isLoading ? (
        <p>加载附件…</p>
      ) : query.data?.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件" />
      ) : null}
      <ul className={styles.list}>
        {query.data?.map((item) => (
          <li key={item.id}>
            <div>
              <Button
                type="link"
                className={styles.filename}
                onClick={() => void download(item)}
              >
                {item.filename}
              </Button>
              <span className={styles.hint}>
                {Math.max(1, Math.ceil(item.byteSize / 1024))} KB ·{" "}
                {new Date(item.createdAt).toLocaleDateString("zh-CN")}
              </span>
            </div>
            {canUpdate && (
              <Popconfirm
                title="删除这个附件？"
                description="删除后无法再下载，操作会保留审计记录。"
                okText="删除"
                cancelText="保留"
                onConfirm={() => mutation.mutate({ remove: item.id })}
              >
                <Button type="text" danger disabled={mutation.isPending}>
                  删除
                </Button>
              </Popconfirm>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
