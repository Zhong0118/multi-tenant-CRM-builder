"use client";

import {
  AimOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Modal,
  Progress,
  Radio,
  Select,
  Spin,
  Switch,
  Table,
  Tooltip,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { MemberIdentity } from "@/components/identity/member-identity";
import { PageSection } from "@/components/layout/page";
import { StatusTag } from "@/components/workbench/status-tag";
import { toApiError } from "@/lib/api/api-error";
import { useLeaveGuard } from "@/lib/hooks/use-leave-guard";
import {
  GOAL_METRICS,
  goalKeys,
  workGoalsApi,
  type GoalMetric,
  type GoalProgressItem,
  type GoalRule,
  type GoalSettings,
  type SaveGoal,
  type WorkGoalsApi,
} from "./work-goals-api";
import styles from "./work-goals.module.css";

type Props = {
  tenantCode: string;
  memberId: string;
  manage?: boolean;
  api?: WorkGoalsApi;
};
type GoalInput = Omit<SaveGoal, "target" | "expectedVersion"> & {
  target: string;
};
type GoalRecovery = {
  metric: GoalMetric;
  input: GoalInput;
  expectedVersion: number;
};
const metricLabel = (metric: GoalMetric) =>
  GOAL_METRICS.find((item) => item.value === metric)!;
const days = ["一", "二", "三", "四", "五", "六", "日"].map((label, index) => ({
  label: `周${label}`,
  value: index + 1,
}));

export function WorkGoalsPanel(props: Props) {
  return (
    <GoalPanel
      key={`${props.tenantCode}:${props.memberId}:${props.manage ?? false}`}
      {...props}
    />
  );
}
function GoalPanel({
  tenantCode,
  memberId,
  manage = false,
  api = workGoalsApi,
}: Props) {
  const queryClient = useQueryClient();
  const recoveryKey =
    manage && memberId
      ? ["goal-editor-recovery", tenantCode, memberId]
      : undefined;
  const [recovery, setRecovery] = useState(() =>
    recoveryKey
      ? queryClient.getQueryData<GoalRecovery>(recoveryKey)
      : undefined,
  );
  const [open, setOpen] = useState(Boolean(recovery));
  const [settings, setSettings] = useState<GoalSettings>();
  const [loading, setLoading] = useState(Boolean(recovery));
  const [loadError, setLoadError] = useState("");
  const [metric, setMetric] = useState<GoalMetric>(recovery?.metric ?? "calls");
  const [dirty, setDirty] = useState(Boolean(recovery));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<GoalMetric | "close" | null>(null);
  const request = useRef(0);
  const leave = useLeaveGuard(open && dirty);
  const progress = useQuery({
    queryKey: [
      ...goalKeys.progress(tenantCode),
      manage ? "team" : "mine",
      memberId,
    ],
    queryFn: () => api.progress(tenantCode, manage ? "team" : "mine"),
    refetchInterval: 60_000,
  });
  const readSettings = useCallback(() => {
    const sequence = ++request.current;
    return api.settings(tenantCode).then(
      (data) => {
        if (sequence === request.current) {
          setSettings(data);
          setLoading(false);
        }
      },
      (error) => {
        if (sequence === request.current) {
          setLoadError(toApiError(error).message);
          setLoading(false);
        }
      },
    );
  }, [api, tenantCode]);
  useEffect(() => {
    // Revalidate access and employee choices before showing recovered inputs.
    if (recovery) void readSettings();
    return () => {
      request.current += 1;
    };
  }, [recovery, readSettings]);
  function loadSettings() {
    setLoading(true);
    setLoadError("");
    setSettings(undefined);
    void readSettings();
  }
  function clearRecovery() {
    if (recoveryKey)
      queryClient.removeQueries({ queryKey: recoveryKey, exact: true });
    setRecovery(undefined);
  }
  function change(next: GoalMetric | "close") {
    if (busy) return;
    if (dirty) {
      setPending(next);
      return;
    }
    applyChange(next);
  }
  function applyChange(next: GoalMetric | "close") {
    clearRecovery();
    setDirty(false);
    setPending(null);
    if (next === "close") {
      request.current += 1;
      setOpen(false);
    } else setMetric(next);
  }
  const items = progress.data?.items ?? [];
  return (
    <PageSection
      title={manage ? "每日目标" : "我的每日目标"}
      description={
        progress.data
          ? `${progress.data.today} · ${progress.data.timezone} · 按实际登记的工作统计`
          : "查看今天的完成情况"
      }
      extra={
        <div className={styles.actions}>
          <Button
            size="small"
            icon={<ReloadOutlined aria-hidden />}
            aria-label="刷新目标进度"
            loading={progress.isFetching}
            onClick={() => void progress.refetch()}
          />
          {manage && (
            <Button
              size="small"
              icon={<SettingOutlined aria-hidden />}
              onClick={() => {
                setOpen(true);
                setDirty(false);
                void loadSettings();
              }}
            >
              配置目标
            </Button>
          )}
        </div>
      }
    >
      {progress.isError && (
        <Alert
          type="error"
          showIcon
          title={`目标进度读取失败：${toApiError(progress.error).message}`}
          action={
            <Button size="small" onClick={() => void progress.refetch()}>
              重试
            </Button>
          }
        />
      )}
      {progress.isPending && (
        <Spin description="正在读取目标">
          <div className={styles.loading} />
        </Spin>
      )}
      {progress.isSuccess && items.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            manage ? "尚未配置启用中的每日目标" : "目前没有分配给你的每日目标"
          }
        />
      )}
      {items.length > 0 &&
        (manage ? (
          <Table<GoalProgressItem>
            size="small"
            rowKey={(row) => `${row.ruleId}:${row.memberId}`}
            dataSource={items}
            pagination={{
              pageSize: 20,
              hideOnSinglePage: true,
              showSizeChanger: false,
            }}
            scroll={{ x: 600 }}
            columns={[
              {
                title: "员工",
                key: "member",
                width: 150,
                render: (_, row) => (
                  <MemberIdentity
                    size="sm"
                    member={{ id: row.memberId, displayName: row.memberName }}
                  />
                ),
              },
              {
                title: "目标",
                key: "metric",
                width: 130,
                render: (_, row) => (
                  <Tooltip title={metricLabel(row.metric).help}>
                    {metricLabel(row.metric).label}
                  </Tooltip>
                ),
              },
              {
                title: "今日进度",
                key: "progress",
                width: 200,
                render: (_, row) => <GoalMeter item={row} />,
              },
              {
                title: "提醒",
                key: "reminder",
                width: 120,
                render: (_, row) =>
                  row.scheduledToday
                    ? `${row.remindAt} 未达成时`
                    : "今日不提醒",
              },
            ]}
          />
        ) : (
          <div className={styles.cards}>
            {items.map((item) => (
              <article className={styles.card} key={item.ruleId}>
                <div className={styles.cardHeading}>
                  <h3>
                    <AimOutlined aria-hidden />
                    {metricLabel(item.metric).label}
                  </h3>
                  <StatusTag
                    tone={item.actual >= item.target ? "success" : "neutral"}
                  >
                    {item.actual >= item.target
                      ? "已达成"
                      : `还差 ${item.target - item.actual}`}
                  </StatusTag>
                </div>
                <GoalMeter item={item} />
                <p>{metricLabel(item.metric).help}</p>
                <span className={styles.reminder}>
                  {item.scheduledToday
                    ? `${item.remindAt} 未达成时提醒`
                    : "今日不提醒"}
                </span>
              </article>
            ))}
          </div>
        ))}
      <Drawer
        title="配置每日目标"
        open={open}
        onClose={() => change("close")}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        size={560}
        rootClassName={styles.drawer}
        styles={{ wrapper: { maxWidth: "100vw" } }}
        extra={
          <Button
            disabled={busy}
            aria-label="关闭目标配置"
            onClick={() => change("close")}
          >
            关闭
          </Button>
        }
      >
        {loading && (
          <Spin description="正在读取配置">
            <div className={styles.loading} />
          </Spin>
        )}
        {loadError && (
          <Alert
            type="error"
            title={loadError}
            action={<Button onClick={() => void loadSettings()}>重试</Button>}
          />
        )}
        {open && settings && (
          <>
            {recovery && (
              <Alert
                type="info"
                showIcon
                title="已恢复本标签页未保存的目标修改"
                description="请核对后保存 草稿保留原配置版本 其他管理员的更新仍会触发冲突检查"
              />
            )}
            <label className={styles.metricPicker}>
              <span>工作指标</span>
              <Select
                aria-label="工作指标"
                value={metric}
                disabled={busy}
                options={GOAL_METRICS.map(({ value, label }) => ({
                  value,
                  label,
                }))}
                onChange={change}
              />
            </label>
            <GoalForm
              key={metric}
              metric={metric}
              initial={settings.rules.find((r) => r.metric === metric)}
              recovery={recovery}
              recoveryKey={recoveryKey}
              settings={settings}
              tenantCode={tenantCode}
              api={api}
              onDirty={setDirty}
              onBusy={setBusy}
              onSaved={(saved) => {
                setRecovery(undefined);
                setSettings(
                  (current) =>
                    current && {
                      ...current,
                      rules: [
                        ...current.rules.filter(
                          (r) => r.metric !== saved.metric,
                        ),
                        saved,
                      ],
                    },
                );
                void progress.refetch();
              }}
            />
          </>
        )}
      </Drawer>
      <Modal
        title="放弃未保存的目标修改？"
        open={pending !== null || leave.pending !== null}
        okText="放弃修改"
        cancelText="继续编辑"
        onCancel={() => {
          setPending(null);
          leave.stay();
        }}
        onOk={() => {
          if (leave.pending) {
            clearRecovery();
            setDirty(false);
            leave.leave();
          } else if (pending) applyChange(pending);
        }}
      >
        尚未保存的目标、员工选择和提醒时间将被丢弃
      </Modal>
    </PageSection>
  );
}
function GoalMeter({ item }: { item: GoalProgressItem }) {
  return (
    <div className={styles.meter}>
      <strong>
        {item.actual} / {item.target}
      </strong>
      <Progress
        percent={Math.min(100, Math.round((item.actual / item.target) * 100))}
        showInfo={false}
        size="small"
        status={item.actual >= item.target ? "success" : "normal"}
      />
    </div>
  );
}
function GoalForm({
  metric,
  initial,
  recovery,
  recoveryKey,
  settings,
  tenantCode,
  api,
  onDirty,
  onBusy,
  onSaved,
}: {
  metric: GoalMetric;
  initial?: GoalRule;
  recovery?: GoalRecovery;
  recoveryKey?: string[];
  settings: GoalSettings;
  tenantCode: string;
  api: WorkGoalsApi;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onSaved: (rule: GoalRule) => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<GoalInput>(
    recovery?.input ?? {
      target: initial ? String(initial.target) : "",
      remindAt: initial?.remindAt ?? "17:00",
      weekdays: initial?.weekdays ?? [1, 2, 3, 4, 5],
      audience: initial?.audience ?? "ALL_EMPLOYEES",
      memberIds: initial?.memberIds ?? [],
      enabled: initial?.enabled ?? true,
    },
  );
  const [version, setVersion] = useState(
    recovery?.expectedVersion ?? initial?.version ?? 0,
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function edit(patch: Partial<typeof input>) {
    const next = { ...input, ...patch };
    setInput(next);
    if (recoveryKey) {
      // Like template recovery, keep drafts only in this tab's root QueryClient.
      queryClient.setQueryDefaults(recoveryKey, { gcTime: Infinity });
      queryClient.setQueryData<GoalRecovery>(recoveryKey, {
        metric,
        input: next,
        expectedVersion: version,
      });
    }
    onDirty(true);
    setSaved(false);
    setError("");
  }
  async function save() {
    if (submitting.current) return;
    if (!/^[1-9]\d*$/.test(input.target) || Number(input.target) > 100000) {
      setError("目标值应为 1–100000 的整数");
      return;
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.remindAt)) {
      setError("请选择有效的提醒时间");
      return;
    }
    if (!input.weekdays.length) {
      setError("请选择至少一个工作日");
      return;
    }
    if (input.audience === "SELECTED_MEMBERS" && !input.memberIds.length) {
      setError("请选择至少一位员工");
      return;
    }
    const body: SaveGoal = {
      ...input,
      target: Number(input.target),
      weekdays: [...input.weekdays].sort(),
      memberIds: input.audience === "ALL_EMPLOYEES" ? [] : input.memberIds,
      expectedVersion: version,
    };
    const savingDraft = recoveryKey
      ? queryClient.getQueryData(recoveryKey)
      : undefined;
    submitting.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await api.save(tenantCode, metric, body);
      // A save may finish after history navigation; do not erase newer edits.
      if (
        recoveryKey &&
        queryClient.getQueryData(recoveryKey) === savingDraft
      ) {
        queryClient.removeQueries({ queryKey: recoveryKey, exact: true });
      }
      if (!alive.current) return;
      setVersion(result.version);
      setSaved(true);
      onDirty(false);
      onSaved(result);
    } catch (failure) {
      if (alive.current) setError(toApiError(failure).message);
    } finally {
      submitting.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <div className={styles.form}>
      <p className={styles.help}>
        {metricLabel(metric).help} · 每个指标可设置一条每日目标
      </p>
      <div className={styles.formRow}>
        <label htmlFor="goal-target">每日目标值</label>
        <Input
          id="goal-target"
          inputMode="numeric"
          value={input.target}
          disabled={busy}
          maxLength={6}
          onChange={(e) => edit({ target: e.target.value })}
          placeholder="填写目标数量"
        />
      </div>
      <div className={styles.formRow}>
        <label htmlFor="goal-time">提醒时间</label>
        <Input
          id="goal-time"
          type="time"
          value={input.remindAt}
          disabled={busy}
          onChange={(e) => edit({ remindAt: e.target.value })}
        />
        <span className={styles.help}>
          使用公司时区 {settings.timezone}，当天未达成时提醒一次
        </span>
      </div>
      <div className={styles.formRow}>
        <span>工作日</span>
        <Checkbox.Group
          aria-label="工作日"
          options={days}
          value={input.weekdays}
          disabled={busy}
          onChange={(weekdays) => edit({ weekdays: weekdays as number[] })}
        />
      </div>
      <div className={styles.formRow}>
        <span>适用员工</span>
        <Radio.Group
          value={input.audience}
          disabled={busy}
          onChange={(e) => edit({ audience: e.target.value })}
        >
          <Radio value="ALL_EMPLOYEES">全体员工</Radio>
          <Radio value="SELECTED_MEMBERS">指定员工</Radio>
        </Radio.Group>
        {input.audience === "SELECTED_MEMBERS" ? (
          <Select
            aria-label="选择员工"
            mode="multiple"
            virtual={false}
            value={input.memberIds}
            labelRender={({ value, label }) =>
              settings.members.some((member) => member.id === value)
                ? label
                : `已停用或不可用员工（${value}）`
            }
            disabled={busy}
            options={settings.members.map((member) => ({
              value: member.id,
              label: member.name,
            }))}
            optionFilterProp="label"
            onChange={(memberIds) => edit({ memberIds })}
            placeholder="搜索并选择员工"
          />
        ) : (
          <span className={styles.help}>包括之后加入公司的员工</span>
        )}
      </div>
      <div className={styles.toggle}>
        <span>启用此目标</span>
        <Switch
          aria-label="启用此目标"
          checked={input.enabled}
          disabled={busy}
          onChange={(enabled) => edit({ enabled })}
        />
      </div>
      {error && <Alert type="error" showIcon title={error} />}
      {saved && <Alert type="success" showIcon title="目标已保存" />}
      <div className={styles.formFooter}>
        <Button type="primary" loading={busy} onClick={() => void save()}>
          保存目标
        </Button>
      </div>
    </div>
  );
}
