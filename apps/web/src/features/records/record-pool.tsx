"use client";

import { ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import {
  DATA_SCOPE_LABELS,
  type RecordSummary,
  type RuntimeObjectSchema,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";
import type { DynamicFieldMember } from "./dynamic-field";
import { formatDateTime } from "./record-display-value";
import {
  DEFAULT_POOL_LABELS,
  CUSTOMER_POOL_LABELS,
  POOL_LABEL_KEYS,
  type PoolLabels,
  type PoolQuality,
  type OwnershipAction,
  type RecordPoolConfig,
} from "./record-pool-types";
import { recordPoolApi, type RecordPoolApi } from "./record-pool-api";
import styles from "./records.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

function PoolDeadline({ expiresAt, serverTime, receivedAt }: { expiresAt: string; serverTime: string; receivedAt?: number }) {
  const [clock] = useState(() => ({ server: Date.parse(serverTime), received: receivedAt ?? Date.now() }));
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - clock.received));
  useEffect(() => {
    const interval = window.setInterval(() => setElapsed(Math.max(0, Date.now() - clock.received)), 30000);
    return () => window.clearInterval(interval);
  }, [clock]);
  const minutes = Math.max(0, Math.ceil((Date.parse(expiresAt) - clock.server - elapsed) / 60000));
  return <Typography.Text type={minutes ? "secondary" : "danger"}>{minutes ? `剩余 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : "已到期，以服务端流转结果为准"}</Typography.Text>;
}

export function RecordPoolStatus({
  record,
  config,
}: {
  record: RecordSummary;
  config?: RecordPoolConfig;
}) {
  const labels = { ...DEFAULT_POOL_LABELS, ...config?.labels };
  return (
    <Space size={4} wrap className={styles.poolStatus}>
      <Tag color={record.inPublicPool ? "blue" : undefined}>
        {record.poolStage
          ? labels[POOL_LABEL_KEYS[record.poolStage]]
          : record.inPublicPool
            ? "公共池（旧记录）"
            : record.ownerMemberId
              ? "已分配"
              : "未分配"}
      </Tag>
      {record.poolQuality ? (
        <Tag color="red">
          {
            { INVALID: "空号 / 无效", DUPLICATE: "重复", LOST: "丢单" }[
              record.poolQuality
            ]
          }
        </Tag>
      ) : null}
      {record.protectionNeedsReview ? (
        <Tag color="red">保护依据待复核</Tag>
      ) : null}
      {record.ownershipExpiresAt && config?.serverTime ? <PoolDeadline key={`${record.ownershipExpiresAt}:${config.serverTime}`} expiresAt={record.ownershipExpiresAt} serverTime={config.serverTime} receivedAt={config.serverTimeReceivedAt} /> : null}
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
    ? `${error.message}，请刷新后重试`
    : `${error.message}（请求编号：${error.requestId}）`;
}

export function useRecordOwnership({
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
  toast = false,
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
  /** Report failures as toasts, for compact hosts such as a row menu. */
  toast?: boolean;
}) {
  const [assigning, setAssigning] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");
  const [quality, setQuality] = useState<PoolQuality>();
  const [releaseStage, setReleaseStage] = useState<
    "LEAD_POOL" | "CUSTOMER_POOL"
  >("LEAD_POOL");
  const lifecycle = Boolean(config?.lifecycleEnabled);
  const protectedRecord = record.poolStage === "PROTECTED";
  const labels = { ...DEFAULT_POOL_LABELS, ...config?.labels };
  const [ownerMemberId, setOwnerMemberId] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [committed, setCommitted] = useState(false);
  const ownership = useMutation({
    mutationFn: (action: OwnershipAction) =>
      api.changeOwnership(tenantCode, objectCode, record.id, {
        action,
        version: record.version,
        ...(action === "ASSIGN" ? { ownerMemberId } : {}),
        ...((action === "RELEASE" || action === "UNPROTECT_RELEASE") &&
        lifecycle
          ? {
              reason: reason.trim(),
              ...(quality ? { quality } : {}),
              ...(!record.poolStage && isAdmin
                ? { poolStage: releaseStage }
                : {}),
            }
          : {}),
      }),
    onError: (caught) => {
      if (toast) void message.error(poolError(caught));
    },
    onSuccess: async (_result, action) => {
      setCommitted(true);
      setAssigning(false);
      setReleasing(false);
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
    (!lifecycle || Boolean(record.poolStage)) &&
    schema.actions.canRead &&
    schema.actions.canUpdate &&
    schema.scopes.update !== "NONE";
  const canRelease =
    config?.enabled &&
    (!protectedRecord || isAdmin) &&
    (!record.inPublicPool || (lifecycle && isAdmin && !record.poolStage)) &&
    (isAdmin ||
      (Boolean(currentMemberId) &&
        record.ownerMemberId === currentMemberId &&
        schema.actions.canUpdate &&
        schema.scopes.update !== "NONE"));
  const disabled = ownership.isPending || committed;
  const canConfirmContact = Boolean(
    lifecycle && config?.enabled && record.poolStage === "PENDING_CONTACT" && canRelease,
  );
  const releaseLabel = protectedRecord
    ? "解除保护并释放"
    : lifecycle && !record.poolStage
      ? "归类到公共池"
      : "释放";
  const drawers = (
    <>
    <Drawer
      open={releasing}
      size={OVERLAY_SIZE.narrow}
      title={
        protectedRecord
          ? "解除保护并释放"
          : !record.poolStage
            ? "旧记录显式归类"
            : "释放到公共池"
      }
      onClose={() => setReleasing(false)}
      destroyOnHidden
    >
      <Space orientation="vertical" className={styles.poolSettings}>
        <Alert
          type="warning"
          showIcon
          title={
            protectedRecord
              ? "管理员确认后解除保护并进入已联系公共池，其他成员可领取"
              : "释放后清空当前负责人和期限，保留内容、关联与跟进历史"
          }
        />
        {!record.poolStage && isAdmin ? (
          <label>
            目标公共池
            <Select
              aria-label="目标公共池"
              value={releaseStage}
              onChange={setReleaseStage}
              options={[
                { value: "LEAD_POOL", label: labels.leadPool },
                { value: "CUSTOMER_POOL", label: labels.customerPool },
              ]}
            />
          </label>
        ) : null}
        <label>
          释放原因（必填）
          <Input.TextArea
            aria-label="释放原因"
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label>
          资源质量
          <Select
            aria-label="资源质量"
            allowClear
            value={quality}
            onChange={setQuality}
            options={[
              { value: "INVALID", label: "空号 / 无效" },
              { value: "DUPLICATE", label: "重复" },
              { value: "LOST", label: "丢单" },
            ]}
          />
        </label>
        {ownership.isError ? (
          <Alert type="error" title={poolError(ownership.error)} />
        ) : null}
        <Button
          type="primary"
          danger
          disabled={!reason.trim() || disabled}
          loading={ownership.isPending}
          onClick={() =>
            ownership.mutate(
              protectedRecord ? "UNPROTECT_RELEASE" : "RELEASE",
            )
          }
        >
          确认释放
        </Button>
      </Space>
    </Drawer>
    <Drawer
      open={assigning}
      size={OVERLAY_SIZE.narrow}
      title={`分配 ${record.title}`}
      onClose={() => setAssigning(false)}
      destroyOnHidden
    >
      <Space orientation="vertical" className={styles.poolSettings}>
        <Typography.Text>选择有该表处理权限的活动成员</Typography.Text>
        {lifecycle ? (
          <Alert
            type="info"
            showIcon
            title={
              protectedRecord
                ? "转交后继续保留保护，不启动回收计时"
                : `分配后进入待联系，${config?.contactTtlHours ?? 24} 小时内须确认联系；超时回原池，旧未指定记录默认回初始公共池`
            }
          />
        ) : null}
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
    </>
  );

  return {
    lifecycle,
    protectedRecord,
    awaitingClassification: lifecycle && record.inPublicPool && !record.poolStage && !isAdmin,
    canClaim: Boolean(canClaim),
    canRelease: Boolean(canRelease),
    canConfirmContact,
    canAssign: isAdmin,
    releaseLabel,
    /** Lifecycle releases need a reason, so they open a form instead of a yes/no. */
    releaseNeedsForm: lifecycle,
    assignLabel: record.ownerMemberId ? "转交" : "分配",
    disabled,
    pendingAction: ownership.isPending ? ownership.variables : undefined,
    claim: () => ownership.mutate("CLAIM"),
    confirmContact: () => ownership.mutate("CONFIRM_CONTACT"),
    release: () => ownership.mutate("RELEASE"),
    startRelease: () => setReleasing(true),
    startAssign: () => setAssigning(true),
    error: ownership.isError ? poolError(ownership.error) : undefined,
    warning,
    drawers,
    // kept for the inline presentation below
    ownership,
    contactHours: config?.followUpTtlHours ?? 720,
    setReleasing,
    setAssigning,
  };
}

export function RecordOwnershipActions(props: Parameters<typeof useRecordOwnership>[0]) {
  const { record, config, isAdmin } = props;
  const {
    canClaim,
    canRelease,
    lifecycle,
    protectedRecord,
    disabled,
    warning,
    ownership,
    setReleasing,
    setAssigning,
    drawers,
  } = useRecordOwnership(props);
  return (
    <span className={styles.poolActions}>
      {lifecycle && record.inPublicPool && !record.poolStage && !isAdmin ? <Typography.Text type="secondary">等待管理员归类后领取</Typography.Text> : null}
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
      {lifecycle &&
      config?.enabled &&
      record.poolStage === "PENDING_CONTACT" &&
      canRelease ? (
        <Popconfirm
          title="确认已经建立联系？"
          description={`确认后开始 ${config.followUpTtlHours ?? 720} 小时跟进期，待联系期间写活动不能代替联系确认`}
          okText="确认建立联系"
          cancelText="取消"
          onConfirm={() => ownership.mutate("CONFIRM_CONTACT")}
        >
          <Button
            size="small"
            aria-label={`确认已联系 ${record.title}`}
            disabled={disabled}
          >
            确认已联系
          </Button>
        </Popconfirm>
      ) : null}
      {canRelease && lifecycle ? (
        <Button
          size="small"
          aria-label={`${protectedRecord ? "解除保护并释放" : "释放"} ${record.title}`}
          disabled={disabled}
          onClick={() => setReleasing(true)}
        >
          {protectedRecord
            ? "解除保护并释放"
            : !record.poolStage
              ? "归类到公共池"
              : "释放"}
        </Button>
      ) : null}
      {canRelease && !lifecycle ? (
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
          {record.ownerMemberId ? "转交" : "分配"}
        </Button>
      ) : null}
      {ownership.isError ? (
        <Alert type="error" showIcon title={poolError(ownership.error)} />
      ) : null}
      {warning ? <Alert type="warning" showIcon title={warning} /> : null}
      {drawers}
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
  const [openedConfig] = useState(config);
  const [version] = useState(config.version);
  const [lifecycle, setLifecycle] = useState(config.lifecycleEnabled ?? false);
  const [contactHours, setContactHours] = useState<number | null>(
    config.contactTtlHours ?? 24,
  );
  const [followUpHours, setFollowUpHours] = useState<number | null>(
    config.followUpTtlHours ?? 720,
  );
  const [labels, setLabels] = useState<PoolLabels>({
    ...DEFAULT_POOL_LABELS,
    ...config.labels,
  });
  const [rules, setRules] = useState(config.protectionRules ?? []);
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
        ...(lifecycle || openedConfig.lifecycleEnabled !== undefined
          ? {
              lifecycleEnabled: lifecycle,
              contactTtlHours: contactHours!,
              followUpTtlHours: followUpHours!,
              labels,
              protectionRules: rules,
            }
          : {}),
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
  const archived = save.isError && toApiError(save.error).code === "OBJECT_ARCHIVED";
  const validHours = (value: number | null) =>
    value !== null && Number.isInteger(value) && value >= 1 && value <= 8760;
  const invalid = lifecycle
    ? !validHours(contactHours) ||
      !validHours(followUpHours) ||
      Object.values(labels).some((label) => !label.trim()) ||
      rules.some((rule) => !rule.sourceObjectCode || !rule.statusKeys.length)
    : automatic && !validHours(hours);
  return (
    <Drawer open title="公共池设置" size={OVERLAY_SIZE.drawer} onClose={onClose} destroyOnHidden
      classNames={{ body: styles.poolSettingsBody, footer: styles.poolSettingsFooter }}
      footer={<div className={styles.poolFooterContent}><span>保存即生效，无需发布</span><Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={save.isPending} disabled={invalid || saved || archived} onClick={() => { if (!archived) save.mutate(); }}>保存设置</Button></Space></div>}
    >
      <Space
        orientation="vertical"
        className={styles.poolSettings}
        size="large"
      >
        <div className={styles.poolSettingsIntro}>
          <Typography.Title level={4}>让资源有序流转</Typography.Title>
          <Typography.Paragraph type="secondary">一张业务表共享资源，分配后由负责人持续跟进</Typography.Paragraph>
        </div>
        <label className={styles.poolSettingRow}>
          <span><strong>启用公共池</strong><small>允许有权限的成员领取公共资源</small></span>
          <Switch
            aria-label="启用公共池"
            checked={enabled}
            onChange={setEnabled}
            disabled={save.isPending || saved || archived}
          />
        </label>
        {!enabled ? <Alert type="warning" showIcon title="关闭后暂停领取、释放和回收" description="原有期限保留，重新开启会处理已到期记录。管理员仍可分配记录" /> : null}
        <section className={styles.poolConfigPreview} aria-label="当前生效规则">
          <div className={styles.poolSectionHeading}><CheckCircleOutlined /><Typography.Text strong>当前生效规则</Typography.Text><Tag>{openedConfig.enabled ? "运行中" : "已关闭"}</Tag></div>
          <p>
            {openedConfig.enabled ? "公共池已启用" : "公共池已关闭"} ·{" "}
            {openedConfig.lifecycleEnabled
              ? `分阶段流转 · 联系 ${openedConfig.contactTtlHours ?? 24} 小时 · 跟进 ${openedConfig.followUpTtlHours ?? 720} 小时`
              : "原有固定持有期"}
          </p>
          {config.preview ? (
            <p>
              旧未指定 {config.preview.legacyUnassigned} 条 · 旧公共池{" "}
              {config.preview.legacyPool} 条 · 旧已分配{" "}
              {config.preview.legacyOwned} 条 · 已到期待回收{" "}
              {config.preview.expiredCount} 条
            </p>
          ) : null}
          {config.permissions ? (
            <p>
              默认员工读取范围 {DATA_SCOPE_LABELS[config.permissions.readScope]} · 处理范围{" "}
              {DATA_SCOPE_LABELS[config.permissions.updateScope]} · 启用不会改动员工权限
            </p>
          ) : null}
        </section>

        <label className={styles.poolSettingRow}>
          <span><strong>启用分阶段流转</strong><small>领取后限时联系，跟进续期，成交后保护</small></span>
          <Switch
            aria-label="启用分阶段流转"
            checked={lifecycle}
            disabled={save.isPending || saved || archived}
            onChange={setLifecycle}
          />
        </label>
        {lifecycle ? (
          <>
            <div className={styles.poolFlow} aria-label="流转规则说明">
              <span>公海资源</span><ArrowRightOutlined /><span>限时联系</span><ArrowRightOutlined /><span>持续跟进</span><ArrowRightOutlined /><span>成交保护</span>
            </div>
            <section className={styles.poolSettingsSection} aria-label="联系与跟进期限">
            <div className={styles.poolSectionHeading}><ClockCircleOutlined /><Typography.Text strong>联系与跟进期限</Typography.Text></div>
            <div className={styles.poolDurationGrid}>
            <label>
              联系期限（小时）
              <InputNumber
                aria-label="联系期限（小时）"
                min={1}
                max={8760}
                precision={0}
                value={contactHours}
                onChange={setContactHours}
                disabled={save.isPending || saved || archived}
              />
            </label>
            <label>
              跟进期限（小时）
              <InputNumber
                aria-label="跟进期限（小时）"
                min={1}
                max={8760}
                precision={0}
                value={followUpHours}
                onChange={setFollowUpHours}
                disabled={save.isPending || saved || archived}
              />
            </label>
            </div>
            <p className={styles.poolHelp}>领取后 {contactHours ?? "—"} 小时内确认联系；确认后获得 {followUpHours === null ? "—" : Number((followUpHours / 24).toFixed(2))} 天跟进期，每次有效跟进重新计时</p>
            </section>
            <section className={styles.poolSettingsSection} aria-label="阶段显示名称">
            <div className={styles.poolSectionHeading}><Typography.Text strong>阶段显示名称</Typography.Text></div>
            <Space wrap className={styles.poolPresetButtons}>
              <Button
                onClick={() => setLabels(DEFAULT_POOL_LABELS)}
                disabled={save.isPending || saved || archived}
              >
                使用通用名称
              </Button>
              <Button
                onClick={() => setLabels(CUSTOMER_POOL_LABELS)}
                disabled={save.isPending || saved || archived}
              >
                使用客户预设
              </Button>
            </Space>
            {(Object.keys(DEFAULT_POOL_LABELS) as (keyof PoolLabels)[]).map(
              (key) => (
                <label key={key} className={styles.poolSettingRow}>
                  {DEFAULT_POOL_LABELS[key]}名称
                  <Input
                    aria-label={`${DEFAULT_POOL_LABELS[key]}名称`}
                    maxLength={40}
                    value={labels[key]}
                    onChange={(event) =>
                      setLabels({ ...labels, [key]: event.target.value })
                    }
                    disabled={save.isPending || saved || archived}
                  />
                </label>
              ),
            )}
            </section>
            <section className={styles.poolSettingsSection} aria-label="成交保护配置">
            <div className={styles.poolSectionHeading}><SafetyCertificateOutlined /><Typography.Text strong>成交 / 合作保护依据</Typography.Text><Tag>可选</Tag></div>
            <Typography.Paragraph type="secondary">
              关联记录达到指定的正式状态后，当前负责人持续持有，不再自动回收。没有负责人的记录需先分配，再确认成交
            </Typography.Paragraph>
            {rules.map((rule, index) => {
              const source = config.protectionSources?.find(
                (item) => item.objectCode === rule.sourceObjectCode,
              );
              return (
                <section key={index} className={styles.poolConfigPreview}>
                  <label>
                    来源业务表
                    <Select
                      aria-label={`保护来源表 ${index + 1}`}
                      value={rule.sourceObjectCode || undefined}
                      disabled={save.isPending || saved || archived}
                      placeholder="选择业务表"
                      options={config.protectionSources?.map((item) => ({
                        value: item.objectCode,
                        label: item.objectName,
                      }))}
                      onChange={(sourceObjectCode) =>
                        setRules(
                          rules.map((item, i) =>
                            i === index
                              ? { sourceObjectCode, statusKeys: [] }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    已发布流程状态
                    <Select
                      aria-label={`保护状态 ${index + 1}`}
                      mode="multiple"
                      value={rule.statusKeys}
                      disabled={!source || save.isPending || saved || archived}
                      options={source?.states.map((item) => ({
                        value: item.key,
                        label: item.label,
                      }))}
                      onChange={(statusKeys) =>
                        setRules(
                          rules.map((item, i) =>
                            i === index ? { ...item, statusKeys } : item,
                          ),
                        )
                      }
                    />
                  </label>
                  {rule.sourceObjectCode && (!source ||
                  !source.states.length ||
                  rule.statusKeys.some(
                    (key) => !source.states.some((state) => state.key === key),
                  )) ? (
                    <Alert
                      type="warning"
                      title="来源表或状态尚未发布，请先在业务表设计器发布流程，再重新打开配置"
                    />
                  ) : null}
                  <Button
                    disabled={save.isPending || saved || archived}
                    onClick={() =>
                      setRules(rules.filter((_, i) => i !== index))
                    }
                  >
                    移除保护依据
                  </Button>
                </section>
              );
            })}
            <Button
              disabled={
                save.isPending || saved || archived || !config.protectionSources?.length
              }
              onClick={() =>
                setRules([...rules, { sourceObjectCode: "", statusKeys: [] }])
              }
            >
              添加保护依据
            </Button>
            {!config.protectionSources?.length ? (
              <Alert
                type="info"
                title="暂无已发布流程可选，可先使用领取、联系和回收；需要保护时先发布来源业务表流程"
              />
            ) : null}
            {!rules.length ? (
              <Typography.Text type="secondary">
                未配置保护依据，不会自动进入受保护阶段
              </Typography.Text>
            ) : null}
            </section>
          </>
        ) : (
          <>
            <label className={styles.poolSettingRow}>
              到期自动回收{" "}
              <Switch
                aria-label="到期自动回收"
                checked={automatic}
                disabled={save.isPending || saved || archived}
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
                  disabled={save.isPending || saved || archived}
                />
              </label>
            ) : null}
          </>
        )}
        <Typography.Paragraph type="secondary">
          新期限用于之后的领取、确认联系与有效跟进，已有截止时间不变。旧数据需手动归类，不会自动进公海
        </Typography.Paragraph>
        <Alert
          type="info"
          showIcon
          title={`将保存：${enabled ? "启用" : "关闭"}公共池 · ${lifecycle ? `联系 ${contactHours ?? "—"} 小时 / 跟进 ${followUpHours ?? "—"} 小时` : "原有固定持有期"}。已有记录不自动归类，已有期限不追溯；重新开启会恢复已到期记录回收`}
        />
        {save.isError ? (
          <Alert type="error" showIcon title={poolError(save.error)} />
        ) : null}
        {warning ? <Alert type="warning" title={warning} /> : null}
      </Space>
    </Drawer>
  );
}
