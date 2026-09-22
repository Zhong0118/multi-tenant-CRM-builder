"use client";

import { Button, Dropdown, Input, Modal, Skeleton } from "antd";
import { useMemo, useState } from "react";

import styles from "./ai-assistant.module.css";
import { conversationGroup } from "./ai-copy";
import type { AiConversation } from "./ai-types";

const GROUPS = ["今天", "最近 7 天", "更早"] as const;

export function ConversationRail({
  conversations,
  selectedId,
  loading,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onLoadMore,
}: {
  conversations: AiConversation[];
  selectedId?: string;
  loading?: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
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

  return (
    <aside className={styles.railInner}>
      <div className={styles.railHeader}>
        <strong>会话</strong>
        <Button type="primary" onClick={onNew}>
          + 新建会话
        </Button>
      </div>
      <div className={styles.railList}>
        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {GROUPS.map((group) =>
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
                          onClick: () => onDelete(item.id),
                        },
                      ],
                    }}
                  >
                    <Button type="text" aria-label="会话操作">
                      ···
                    </Button>
                  </Dropdown>
                </div>
              ))}
            </section>
          ),
        )}
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
          if (renaming && title.trim()) onRename(renaming.id, title.trim());
          setRenaming(undefined);
        }}
      >
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
      </Modal>
    </aside>
  );
}
