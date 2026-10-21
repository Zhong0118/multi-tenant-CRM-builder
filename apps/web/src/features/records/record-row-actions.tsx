"use client";

import { EllipsisOutlined } from "@ant-design/icons";
import { Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";

import type { RecordSummary } from "@/features/objects/object-types";

import { useRecordOwnership } from "./record-pool";
import styles from "./records.module.css";

type OwnershipProps = Parameters<typeof useRecordOwnership>[0];

export interface RecordRowActionsProps extends Omit<OwnershipProps, "toast"> {
  record: RecordSummary;
  editable: boolean;
  /** Why editing is unavailable, shown next to the disabled menu item. */
  editBlockedReason: string;
  canDelete: boolean;
  deleting: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Every action for one table row behind a single trigger, so the table does not
 * need a wide pinned column that covers its data. Destructive and
 * hard-to-reverse choices still ask for confirmation before they run.
 */
export function RecordRowActions({
  record,
  editable,
  editBlockedReason,
  canDelete,
  deleting,
  onView,
  onEdit,
  onDelete,
  ...ownershipProps
}: RecordRowActionsProps) {
  const owner = useRecordOwnership({ ...ownershipProps, record, toast: true });
  const [confirm, setConfirm] = useState<"delete" | "release" | null>(null);

  const items: MenuProps["items"] = [
    { key: "view", label: "查看", onClick: onView },
    {
      key: "edit",
      label: editable ? "编辑" : `编辑（${editBlockedReason}）`,
      disabled: !editable,
      onClick: onEdit,
    },
    ...(owner.canClaim
      ? [{ key: "claim", label: "领取", disabled: owner.disabled, onClick: owner.claim }]
      : []),
    ...(owner.canAssign
      ? [{ key: "assign", label: "分配负责人", disabled: owner.disabled, onClick: owner.startAssign }]
      : []),
    ...(owner.canRelease
      ? [{
          key: "release",
          label: "释放到公共池",
          disabled: owner.disabled,
          onClick: () => setConfirm("release"),
        }]
      : []),
    { type: "divider" },
    {
      key: "delete",
      danger: true,
      label: canDelete ? "删除" : "删除（无删除权限）",
      disabled: !canDelete,
      onClick: () => setConfirm("delete"),
    },
  ];

  return (
    <>
      <Dropdown trigger={["click"]} menu={{ items }} placement="bottomRight">
        <Button
          type="text"
          size="small"
          className={styles.rowActionButton}
          aria-label={`更多操作 ${record.title}`}
          icon={<EllipsisOutlined aria-hidden />}
          loading={deleting || owner.pendingAction !== undefined}
        />
      </Dropdown>
      <Modal
        open={confirm === "delete"}
        title={`确认删除 ${record.title}？`}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onCancel={() => setConfirm(null)}
        onOk={() => {
          setConfirm(null);
          onDelete();
        }}
      >
        <p>删除后业务列表不再显示，审计历史仍会保留。</p>
      </Modal>
      <Modal
        open={confirm === "release"}
        title="释放到公共池？"
        okText="确认释放"
        cancelText="取消"
        onCancel={() => setConfirm(null)}
        onOk={() => {
          setConfirm(null);
          owner.release();
        }}
      >
        <p>释放后负责人和回收时间将清空，其他成员可以领取</p>
      </Modal>
      {owner.drawers}
    </>
  );
}
