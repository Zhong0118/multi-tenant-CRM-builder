"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import type { DynamicFieldMember } from "./dynamic-field";
import { formatDateTime } from "./record-display-value";
import {
  recordPoolApi,
  type OwnershipAction,
  type RecordPoolApi,
  type RecordPoolConfig,
} from "./record-pool-api";
import styles from "./records.module.css";

export function RecordPoolStatus({ record }: { record: RecordSummary }) {
  return (
    <Space size={4} wrap className={styles.poolStatus}>
      <Tag color={record.inPublicPool ? "blue" : undefined}>
        {record.inPublicPool
          ? "公共池"
          : record.ownerMemberId
            ? "已分配"
            : "未分配"}
      </Tag>
      {record.ownershipExpiresAt ? (
        <Typography.Text type="secondary">
          回收于{" "}
          <time dateTime={record.ownershipExpiresAt}>
            {formatDateTime(record.ownershipExpiresAt)}
          </time>
        </Typography.Text>
      ) : null}
    </Space>
  );
}

function poolError(caught: unknown) {
  const error = toApiError(caught);
  return error.status === 409
    ? "记录或设置已被更新，请刷新后重试"
    : `${error.message}（请求编号：${error.requestId}）`;
}

export function RecordOwnershipActions({
  tenantCode,
  objectCode,
  record,
  schema,
  config,
  currentMemberId,
  isAdmin,
  members = [],
  api = recordPoolApi,
  onChanged,
}: {
  tenantCode: string;
  objectCode: string;
  record: RecordSummary;
  schema: RuntimeObjectSchema;
  config?: RecordPoolConfig;
  currentMemberId?: string;
  isAdmin: boolean;
  members?: DynamicFieldMember[];
  api?: RecordPoolApi;
  onChanged: (action: OwnershipAction) => void | Promise<void>;
}) {
  const [assigning, setAssigning] = useState(false);
  const [ownerMemberId, setOwnerMemberId] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [committed, setCommitted] = useState(false);
  const ownership = useMutation({
    mutationFn: (action: OwnershipAction) =>
      api.changeOwnership(tenantCode, objectCode, record.id, {
        action,
        version: record.version,
        ...(action === "ASSIGN" ? { ownerMemberId } : {}),
      }),
    onSuccess: async (_result, action) => {
      setCommitted(true);
      setAssigning(false);
      try {
        await onChanged(action);
      } catch {
        setWarning("操作已完成，但刷新失败，请重新载入，不要重复提交");
      }
    },
  });
  const canClaim =
    config?.enabled &&
    record.inPublicPool &&
    schema.actions.canRead &&
    schema.actions.canUpdate &&
    schema.scopes.update !== "NONE";
  const canRelease =
    config?.enabled &&
    !record.inPublicPool &&
    (isAdmin ||
      (Boolean(currentMemberId) &&
        record.ownerMemberId === currentMemberId &&
        schema.actions.canUpdate &&
        schema.scopes.update !== "NONE"));
  const disabled = ownership.isPending || committed;
  return (
    <span className={styles.poolActions}>
      {canClaim ? (
        <Button
          size="small"
          aria-label={`领取 ${record.title}`}
          disabled={disabled}
          loading={ownership.isPending && ownership.variables === "CLAIM"}
          onClick={() => ownership.mutate("CLAIM")}
        >
          领取
        </Button>
      ) : null}
      {canRelease ? (
        <Popconfirm
          title="释放到公共池？"
          description="释放后负责人和回收时间将清空，其他成员可以领取"
          okText="确认释放"
          cancelText="取消"
          onConfirm={() => ownership.mutate("RELEASE")}
        >
          <Button
            size="small"
            aria-label={`释放 ${record.title}`}
            disabled={disabled}
          >
            释放
          </Button>
        </Popconfirm>
      ) : null}
      {isAdmin ? (
        <Button
          size="small"
          aria-label={`分配 ${record.title}`}
          disabled={disabled}
          onClick={() => setAssigning(true)}
        >
          分配
        </Button>
      ) : null}
      {ownership.isError ? (
        <Alert type="error" showIcon title={poolError(ownership.error)} />
      ) : null}
      {warning ? <Alert type="warning" showIcon title={warning} /> : null}
      <Drawer
        open={assigning}
        title={`分配 ${record.title}`}
        onClose={() => setAssigning(false)}
        destroyOnHidden
      >
        <Space orientation="vertical" className={styles.poolSettings}>
          <Typography.Text>选择负责人</Typography.Text>
          <Select
            aria-label="分配负责人"
            placeholder="选择活动成员"
            showSearch
            optionFilterProp="label"
            value={ownerMemberId}
            onChange={setOwnerMemberId}
            options={members.map((member) => ({
              value: member.id,
              label: member.displayName ?? "未设置姓名",
            }))}
          />
          <Button
            type="primary"
            disabled={!ownerMemberId || disabled}
            loading={ownership.isPending}
            onClick={() => ownership.mutate("ASSIGN")}
          >
            确认分配
          </Button>
          {ownership.isError ? (
            <Alert type="error" title={poolError(ownership.error)} />
          ) : null}
        </Space>
      </Drawer>
    </span>
  );
}

export function RecordPoolSettings({
  tenantCode,
  objectCode,
  config,
  api = recordPoolApi,
  onSaved,
  onClose,
}: {
  tenantCode: string;
  objectCode: string;
  config: RecordPoolConfig;
  api?: RecordPoolApi;
  onSaved: (config: RecordPoolConfig) => void | Promise<void>;
  onClose: () => void;
}) {
  const [version] = useState(config.version);
  const [enabled, setEnabled] = useState(config.enabled);
  const [hours, setHours] = useState<number | null>(config.ownershipTtlHours);
  const [automatic, setAutomatic] = useState(config.ownershipTtlHours !== null);
  const [warning, setWarning] = useState<string>();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.saveConfig(tenantCode, objectCode, {
        enabled,
        ownershipTtlHours: automatic ? hours : null,
        version,
      }),
    onSuccess: async (next) => {
      setSaved(true);
      try {
        await onSaved(next);
        onClose();
      } catch {
        setWarning("设置已保存，但刷新失败，请重新载入，不要重复提交");
      }
    },
  });
  const invalid =
    automatic &&
    (hours === null || !Number.isInteger(hours) || hours < 1 || hours > 8760);
  return (
    <Drawer open title="公共池设置" onClose={onClose} destroyOnHidden>
      <Space
        orientation="vertical"
        className={styles.poolSettings}
        size="large"
      >
        <Typography.Paragraph>
          保存后立即生效，无需发布业务表。已有未分配记录不会自动进入公共池
        </Typography.Paragraph>
        <label className={styles.poolSettingRow}>
          启用公共池{" "}
          <Switch
            aria-label="启用公共池"
            checked={enabled}
            onChange={setEnabled}
            disabled={save.isPending || saved}
          />
        </label>
        <Alert
          type="info"
          showIcon
          title="关闭后暂停领取、释放和自动回收，记录及已有期限会保留。重新开启后，到期记录恢复回收，管理员仍可分配记录"
        />
        <label className={styles.poolSettingRow}>
          到期自动回收{" "}
          <Switch
            aria-label="到期自动回收"
            checked={automatic}
            disabled={save.isPending || saved}
            onChange={(value) => {
              setAutomatic(value);
              if (value && hours === null) setHours(24);
            }}
          />
        </label>
        {automatic ? (
          <label className={styles.poolSettingRow}>
            保留小时数{" "}
            <InputNumber
              aria-label="保留小时数"
              min={1}
              max={8760}
              precision={0}
              value={hours}
              onChange={setHours}
              disabled={save.isPending || saved}
            />
          </label>
        ) : null}
        <Typography.Paragraph type="secondary">
          期限仅应用于之后的领取和分配，不改变已有到期时间。普通编辑不会延长期限
        </Typography.Paragraph>
        {save.isError ? (
          <Alert type="error" showIcon title={poolError(save.error)} />
        ) : null}
        {warning ? <Alert type="warning" title={warning} /> : null}
        <Button
          type="primary"
          loading={save.isPending}
          disabled={invalid || saved}
          onClick={() => save.mutate()}
        >
          保存设置
        </Button>
      </Space>
    </Drawer>
  );
}
