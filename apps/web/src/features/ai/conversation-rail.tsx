"use client";

import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Modal, Skeleton } from "antd";
import { useMemo, useRef, useState } from "react";

import styles from "./ai-assistant.module.css";
import { conversationGroup } from "./ai-copy";
import type { AiConversation } from "./ai-types";

const GROUPS = ["今天", "最近 7 天", "更早"] as const;

export function ConversationRail({
  conversations,
  selectedId,
  loading,
  error,
  onRetry,
  onNew,
  onSelect,
  onRename,
  onDelete,
  mutationError,
  renamePending = false,
  deletePending = false,
  onLoadMore,
}: {
  conversations: AiConversation[];
  selectedId?: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void | Promise<unknown>;
  onDelete: (id: string) => void | Promise<unknown>;
  mutationError?: string | null;
  renamePending?: boolean;
  deletePending?: boolean;
  onLoadMore?: () => void;
}) {
  const grouped = useMemo(() => {
    const buckets: Record<(typeof GROUPS)[number], AiConversation[]> = {
      今天: [],
      "最近 7 天": [],
      更早: [],
    };
    for (const item of conversations) {
      buckets[conversationGroup(item.lastMessageAt)].push(item);
    }
    return buckets;
  }, [conversations]);
  const [renaming, setRenaming] = useState<AiConversation>();
  const [title, setTitle] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const renameSubmittingRef = useRef(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState<string>();

  return (
    <aside className={styles.railInner}>
      <div className={styles.railHeader}>
        <p className={styles.railBrand}>AI 会话</p>
        <Button className={styles.railNew} type="primary" onClick={onNew}>
          + 新建会话
        </Button>
      </div>
      <div className={styles.railList}>
        {mutationError ? <div className={styles.railError} role="alert">{mutationError}</div> : null}
        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {error ? (
          <div className={styles.railError} role="alert">
            <span>会话加载失败</span>
            {onRetry ? <Button type="link" size="small" onClick={onRetry}>重试</Button> : null}
          </div>
        ) : null}
        {!loading && !error ? GROUPS.map((group) =>
          grouped[group].length === 0 ? null : (
            <section key={group}>
              <div className={styles.groupLabel}>{group}</div>
              {grouped[group].map((item) => (
                <div
                  key={item.id}
                  className={`${styles.row} ${item.id === selectedId ? styles.rowActive : ""}`}
                >
                  <button
                    type="button"
                    className={styles.rowTitle}
                    onClick={() => onSelect(item.id)}
                  >
                    {item.title}
                  </button>
                  <Dropdown
                    trigger={["click"]}
                    getPopupContainer={() => document.body}
                    menu={{
                      items: [
                        {
                          key: "rename",
                          label: "重命名",
                          onClick: () => {
                            setRenaming(item);
                            setTitle(item.title);
                          },
                        },
                        {
                          key: "delete",
                          label: "删除",
                          danger: true,
                          onClick: () => {
                             if (deletePending || deleteSubmitting) return;
                             setDeleteSubmitting(item.id);
                             Promise.resolve(onDelete(item.id)).catch(() => undefined).finally(() => setDeleteSubmitting(undefined));
                           },
                        },
                      ],
                    }}
                  >
                    <Button
                      type="text"
                      className={styles.rowMenu}
                      aria-label={`会话操作：${item.title}`}
                      icon={<MoreOutlined aria-hidden />}
                    />
                  </Dropdown>
                </div>
              ))}
            </section>
          ),
        ) : null}
        {onLoadMore ? (
          <Button type="link" onClick={onLoadMore}>
            加载更多
          </Button>
        ) : null}
      </div>
      <Modal
        open={!!renaming}
        title="重命名会话"
        onCancel={() => setRenaming(undefined)}
        onOk={() => {
          if (!renaming || !title.trim() || renamePending || renameSubmittingRef.current) return;
          renameSubmittingRef.current = true;
          setRenameSubmitting(true);
          Promise.resolve(onRename(renaming.id, title.trim()))
            .catch(() => undefined)
            .finally(() => {
              renameSubmittingRef.current = false;
              setRenameSubmitting(false);
              setRenaming(undefined);
            });
        }}
        confirmLoading={renamePending || renameSubmitting}
        okButtonProps={{ disabled: !title.trim() || renamePending || renameSubmitting }}
      >
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
      </Modal>
    </aside>
  );
}
