"use client";

import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
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
  hideBrand = false,
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
  hideBrand?: boolean;
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
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const renameSubmittingRef = useRef(false);
  const [deleting, setDeleting] = useState<AiConversation>();
  const [deleteSubmitting, setDeleteSubmitting] = useState<string>();
  const empty = !loading && !error && conversations.length === 0;
  const railRef = useRef<HTMLElement>(null);
  // The menu item that opened a dialog unmounts with the menu, so focus goes
  // back to the row's menu button (or to 新建会话 once the row is deleted).
  const returnFocusId = useRef<string | null>(null);

  function restoreFocus() {
    const id = returnFocusId.current;
    returnFocusId.current = null;
    if (!id) return;
    const rail = railRef.current;
    const trigger = Array.from(
      rail?.querySelectorAll<HTMLElement>("[data-conversation-menu]") ?? [],
    ).find((element) => element.dataset.conversationMenu === id);
    (trigger ?? rail?.querySelector<HTMLElement>("[data-rail-new]"))?.focus();
  }

  function closeRename() {
    if (renameSubmittingRef.current) return;
    setRenaming(undefined);
    setRenameError(null);
  }

  function submitRename() {
    if (!renaming || !title.trim() || renamePending || renameSubmittingRef.current) return;
    renameSubmittingRef.current = true;
    setRenameSubmitting(true);
    setRenameError(null);
    Promise.resolve(onRename(renaming.id, title.trim()))
      .then(() => setRenaming(undefined))
      .catch((reason: unknown) => {
        // Keep the dialog and the typed title so the user can retry.
        setRenameError(
          reason instanceof Error && reason.message
            ? reason.message
            : "重命名失败，请稍后重试。",
        );
      })
      .finally(() => {
        renameSubmittingRef.current = false;
        setRenameSubmitting(false);
      });
  }

  function confirmDelete() {
    if (!deleting || deletePending || deleteSubmitting) return;
    setDeleteSubmitting(deleting.id);
    Promise.resolve(onDelete(deleting.id))
      .catch(() => undefined)
      .finally(() => {
        setDeleteSubmitting(undefined);
        setDeleting(undefined);
      });
  }

  return (
    <aside ref={railRef} className={styles.railInner}>
      <div className={styles.railHeader}>
        {hideBrand ? null : <p className={styles.railBrand}>AI 会话</p>}
        <Button
          className={styles.railNew}
          type="primary"
          icon={<PlusOutlined aria-hidden />}
          data-rail-new
          onClick={onNew}
        >
          新建会话
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
        {empty ? (
          <p className={styles.railEmpty}>还没有会话。发送第一个问题后，会话会保存在这里。</p>
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
                    title={item.title}
                    aria-current={item.id === selectedId ? "true" : undefined}
                    onClick={() => onSelect(item.id)}
                  >
                    {item.title}
                  </button>
                  <Dropdown
                    trigger={["click"]}
                    autoFocus
                    getPopupContainer={() => document.body}
                    menu={{
                      items: [
                        {
                          key: "rename",
                          label: "重命名",
                          onClick: () => {
                            returnFocusId.current = item.id;
                            setRenaming(item);
                            setTitle(item.title);
                            setRenameError(null);
                          },
                        },
                        {
                          key: "delete",
                          label: "删除",
                          danger: true,
                          disabled: deletePending || !!deleteSubmitting,
                          onClick: () => {
                            returnFocusId.current = item.id;
                            setDeleting(item);
                          },
                        },
                      ],
                    }}
                  >
                    <Button
                      type="text"
                      className={styles.rowMenu}
                      data-conversation-menu={item.id}
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
        okText="保存"
        cancelText="取消"
        onCancel={closeRename}
        onOk={submitRename}
        afterClose={restoreFocus}
        confirmLoading={renamePending || renameSubmitting}
        okButtonProps={{ disabled: !title.trim() || renamePending || renameSubmitting }}
        destroyOnHidden
      >
        <Input
          aria-label="会话名称"
          value={title}
          maxLength={120}
          autoFocus
          status={renameError ? "error" : undefined}
          onChange={(event) => {
            setTitle(event.target.value);
            if (renameError) setRenameError(null);
          }}
          onPressEnter={submitRename}
        />
        {renameError ? (
          <div className={styles.renameError} role="alert">
            {renameError}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={!!deleting}
        title="删除这个会话？"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={!!deleteSubmitting || deletePending}
        onOk={confirmDelete}
        afterClose={restoreFocus}
        onCancel={() => {
          if (!deleteSubmitting) setDeleting(undefined);
        }}
      >
        <p className={styles.deleteCopy}>
          「{deleting?.title}」及其全部消息删除后无法找回。已确认执行的 CRM 修改不会撤销。
        </p>
      </Modal>
    </aside>
  );
}
