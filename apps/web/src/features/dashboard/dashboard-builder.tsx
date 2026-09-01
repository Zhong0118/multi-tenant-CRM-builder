"use client";

import { Alert, Button } from "antd";
import { useEffect, useMemo, useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import {
  previewDashboardDraft,
  publishDashboardDraft,
  saveDashboardDraft,
} from "./dashboard-api";
import { DashboardCanvas } from "./dashboard-canvas";
import { DashboardWidgetInspector } from "./dashboard-widget-inspector";
import { DashboardWidgetLibrary } from "./dashboard-widget-library";
import type {
  DashboardConfigurationView,
  DashboardDefinitionV2,
  DashboardRuntime,
  DashboardWidgetDraft,
  DashboardWidgetType,
} from "./dashboard-types";
import styles from "./dashboard-configuration.module.css";

export function DashboardBuilder({
  tenantCode,
  initial,
}: {
  tenantCode: string;
  initial: DashboardConfigurationView;
}) {
  const initialDefinition =
    initial.draft?.draftConfiguration ?? emptyDefinition();
  const [version, setVersion] = useState(initial.draft?.draftVersion ?? 0);
  const [definition, setDefinition] =
    useState<DashboardDefinitionV2>(initialDefinition);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialDefinition.widgets[0]?.id,
  );
  const [savedSignature, setSavedSignature] = useState(
    signature(initialDefinition),
  );
  const [savedThisSession, setSavedThisSession] = useState(false);
  const [feedback, setFeedback] = useState<string>();
  const [serverVersion, setServerVersion] = useState<number>();
  const [preview, setPreview] = useState<DashboardRuntime>();
  const [busy, setBusy] = useState<"save" | "preview" | "publish">();
  const [focusPath, setFocusPath] = useState<string>();
  const dirty = signature(definition) !== savedSignature;
  const selected = definition.widgets.find(
    (widget) => widget.id === selectedId,
  );
  const issues = useMemo(() => initial.issues, [initial.issues]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptLink = (event: MouseEvent) => {
      if (
        !dirty ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[href]");
      if (
        !target ||
        target.target ||
        target.download ||
        target.origin !== window.location.origin
      )
        return;
      if (!window.confirm("当前修改尚未保存，确定离开吗？"))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", interceptLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", interceptLink, true);
    };
  }, [dirty]);

  function updateWidgets(next: DashboardWidgetDraft[]) {
    setDefinition((current) => ({
      ...current,
      widgets: normalizeWidgets(next),
    }));
  }
  function select(id: string, path?: string) {
    setSelectedId(id);
    setFocusPath(path);
  }
  function add(type: DashboardWidgetType) {
    const ordinal =
      definition.widgets.filter((widget) => widget.type === type).length + 1;
    const widget = createWidget(type, ordinal, definition.widgets.length + 1);
    updateWidgets([...definition.widgets, widget]);
    select(widget.id);
  }
  function copy(id: string) {
    const source = definition.widgets.find((widget) => widget.id === id);
    if (!source) return;
    const ordinal =
      definition.widgets.filter((widget) => widget.type === source.type)
        .length + 1;
    const clone = {
      ...source,
      id: `${kind(source.type)}-${ordinal}`,
      title: `${label(source.type)} ${ordinal}`,
    };
    updateWidgets([...definition.widgets, clone]);
    select(clone.id);
  }
  async function save() {
    setBusy("save");
    setFeedback(undefined);
    setServerVersion(undefined);
    try {
      const saved = await saveDashboardDraft(tenantCode, {
        expectedVersion: version,
        configuration: normalized(definition),
      });
      setVersion(saved.draftVersion);
      setSavedSignature(signature(definition));
      setSavedThisSession(true);
      setFeedback("草稿已保存，尚未发布。");
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === "DASHBOARD_DRAFT_VERSION_CONFLICT") {
        setServerVersion(currentVersion(apiError.fieldErrors.currentVersion));
        setFeedback("草稿版本已变化；本地修改已保留，请重新载入后合并。");
      } else {
        setFeedback("保存草稿失败；请修复配置后重试。");
      }
    } finally {
      setBusy(undefined);
    }
  }
  async function showPreview() {
    setBusy("preview");
    try {
      setPreview(
        await previewDashboardDraft(tenantCode, { expectedVersion: version }),
      );
      setFeedback("已按保存的草稿生成预览。");
    } catch {
      setFeedback("无法预览保存的草稿，请检查组件问题。");
    } finally {
      setBusy(undefined);
    }
  }
  async function publish() {
    setBusy("publish");
    try {
      const publication = await publishDashboardDraft(tenantCode, {
        expectedVersion: version,
      });
      setSavedThisSession(true);
      setFeedback(`工作台已发布为第 ${publication.number} 版。`);
    } catch {
      setFeedback("发布被阻止；请修复画布中的问题后重试。");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className={styles.builderPage}>
      <header className={styles.builderHeader}>
        <div>
          <h1>组件化工作台</h1>
          <p>编排已发布业务表的运营组件；保存草稿不会影响线上版本。</p>
        </div>
        <div className={styles.headerActions}>
          <span>
            {dirty ? "有未保存修改" : `草稿版本 ${version || "未保存"}`}
          </span>
          <span>
            {initial.activePublication
              ? `线上第 ${initial.activePublication.number} 版`
              : "尚未发布"}
          </span>
          <Button onClick={() => void save()} loading={busy === "save"}>
            保存草稿
          </Button>
          <Button
            onClick={() => void showPreview()}
            disabled={dirty || !version}
            loading={busy === "preview"}
          >
            预览草稿
          </Button>
          <Button
            type="primary"
            onClick={() => void publish()}
            disabled={dirty || !savedThisSession || !version}
            loading={busy === "publish"}
          >
            发布工作台
          </Button>
        </div>
      </header>
      {feedback ? (
        <Alert
          className={styles.feedback}
          showIcon
          type="info"
          title={feedback}
        />
      ) : null}
      {serverVersion ? (
        <Alert
          className={styles.feedback}
          showIcon
          type="warning"
          title={`服务器草稿版本为 ${serverVersion}`}
          description="本地内容没有被覆盖。"
        />
      ) : null}
      {preview ? <PreviewPanel preview={preview} /> : null}
      <div className={styles.builderLayout}>
        <DashboardWidgetLibrary onAdd={add} widgets={definition.widgets} />
        <DashboardCanvas
          widgets={definition.widgets}
          selectedId={selectedId}
          issues={issues}
          onSelect={(id) => select(id)}
          onIssue={(id, path) => select(id, path)}
          onCopy={copy}
          onDelete={(id) => {
            const next = definition.widgets.filter(
              (widget) => widget.id !== id,
            );
            updateWidgets(next);
            select(next[0]?.id ?? "");
          }}
          onWidth={(id, width) =>
            updateWidgets(
              definition.widgets.map((widget) =>
                widget.id === id ? { ...widget, width } : widget,
              ),
            )
          }
          onMove={(from, to) => {
            const next = [...definition.widgets];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            updateWidgets(next);
          }}
        />
        <DashboardWidgetInspector
          widget={selected}
          candidates={initial.candidates}
          focusPath={focusPath}
          onChange={(next) =>
            updateWidgets(
              definition.widgets.map((widget) =>
                widget.id === next.id ? next : widget,
              ),
            )
          }
        />
      </div>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: DashboardRuntime }) {
  return (
    <section className={styles.previewPanel} aria-label="草稿预览">
      <strong>草稿预览</strong>
      {preview.widgets.map((widget) => (
        <article key={widget.id}>
          <b>{widget.title}</b>
          <span>
            {widget.state === "UNAVAILABLE"
              ? `不可用：${widget.reason ?? "未知原因"}`
              : previewSummary(widget)}
          </span>
        </article>
      ))}
    </section>
  );
}
function previewSummary(widget: DashboardRuntime["widgets"][number]) {
  if (widget.state === "UNAVAILABLE") return widget.reason ?? "不可用";
  if (widget.type === "METRIC")
    return widget.data.value == null ? "无数据" : String(widget.data.value);
  if (
    widget.type === "STATUS_DISTRIBUTION" ||
    widget.type === "TREND" ||
    widget.type === "LEADERBOARD" ||
    widget.type === "RECORD_LIST"
  )
    return `${widget.data.items.length} 项`;
  return "";
}
function emptyDefinition(): DashboardDefinitionV2 {
  return { schemaVersion: 2, title: "工作台", widgets: [] };
}
function normalized(value: DashboardDefinitionV2): DashboardDefinitionV2 {
  return { ...value, widgets: normalizeWidgets(value.widgets) };
}
function normalizeWidgets(widgets: DashboardWidgetDraft[]) {
  return widgets.map((widget, index) => ({ ...widget, sortOrder: index + 1 }));
}
function signature(value: DashboardDefinitionV2) {
  return JSON.stringify(normalized(value));
}
function currentVersion(value?: string[]) {
  const candidate = value?.[0];
  return candidate && /^\d+$/.test(candidate) ? Number(candidate) : undefined;
}
function createWidget(
  type: DashboardWidgetType,
  ordinal: number,
  sortOrder: number,
): DashboardWidgetDraft {
  const base = {
    id: `${kind(type)}-${ordinal}`,
    title: `${label(type)} ${ordinal}`,
    audience: "ALL" as const,
    objectCode: "",
    width: type === "METRIC" ? ("QUARTER" as const) : ("HALF" as const),
    sortOrder,
    filters: [],
  };
  switch (type) {
    case "METRIC":
      return { ...base, type, aggregation: "COUNT", displayFormat: "NUMBER" };
    case "STATUS_DISTRIBUTION":
      return {
        ...base,
        type,
        groupByFieldKey: "",
        optionKeys: [],
        display: "BAR",
        aggregation: "COUNT",
      };
    case "TREND":
      return {
        ...base,
        type,
        dateFieldKey: "",
        granularity: "AUTO",
        aggregation: "COUNT",
      };
    case "LEADERBOARD":
      return {
        ...base,
        type,
        memberSource: "RECORD_OWNER",
        aggregation: "COUNT",
        limit: 10,
      };
    case "RECORD_LIST":
      return {
        ...base,
        type,
        fieldKeys: [],
        sort: { field: "updatedAt", direction: "DESC" },
        limit: 8,
      };
  }
}
function kind(type: DashboardWidgetType) {
  return {
    METRIC: "metric",
    STATUS_DISTRIBUTION: "distribution",
    TREND: "trend",
    LEADERBOARD: "leaderboard",
    RECORD_LIST: "records",
  }[type];
}
function label(type: DashboardWidgetType) {
  return {
    METRIC: "指标卡",
    STATUS_DISTRIBUTION: "状态分布",
    TREND: "趋势图",
    LEADERBOARD: "员工业绩排行",
    RECORD_LIST: "记录列表",
  }[type];
}
