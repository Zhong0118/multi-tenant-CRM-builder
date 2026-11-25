"use client";

import { SalesWriting } from "./sales-writing";
import { useAiFeature } from "@/features/ai-governance/access";
import { ArrowLeftOutlined, EditOutlined } from "@ant-design/icons";
import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { Button, Drawer, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import type { FilterRule } from "@crm/contracts";
import type { AssistantPageContext } from "./assistant-commands";
import { useEditorDraft } from "./assistant-filter-draft";
import {
  describeRecordFilter,
  type RecordFilterPanelProps,
} from "@/features/records/record-filter-panel";
import { AiAssistantPage } from "./ai-assistant-page";
import {
  sessionKey,
  useAssistantSession,
  writeAssistantSession,
} from "./assistant-session";
import panelStyles from "./assistant-panel.module.css";

interface PanelProps {
  tenantCode: string;
  memberId?: string;
  objectCode: string;
  objectName: string;
  recordId?: string;
  recordTitle?: string;
  viewId?: string;
  viewName?: string;
  rule?: FilterRule;
  onApply?: (rule: FilterRule) => void;
  describeRule?: (rule: FilterRule) => string;
}

export function AssistantPanelButton(props: PanelProps) {
  const assistant = useAiFeature("assistant");
  const writing = useAiFeature("writing") && Boolean(props.recordId);
  return assistant || writing ? (
    <AvailableAssistantPanel
      key={`${assistant}-${writing}`}
      {...props}
      assistant={assistant}
      writing={writing}
    />
  ) : null;
}

function AvailableAssistantPanel(
  props: PanelProps & { assistant: boolean; writing: boolean },
) {
  const {
    tenantCode,
    memberId,
    objectCode,
    objectName,
    recordId,
    recordTitle,
    viewId,
    viewName,
    rule,
    onApply,
    describeRule,
  } = props;
  const [open, setOpen] = useState(false);
  const [compose, setCompose] = useState(!props.assistant);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!props.writing || url.searchParams.get("writing") !== "1") return;
    url.searchParams.delete("writing");
    window.history.replaceState(window.history.state, "", url);
    // Consume the one-shot record link after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompose(true);
    setOpen(true);
  }, [props.writing, recordId]);
  // The panel works beside the page rather than over it: no mask, no focus
  // trap, and on a wide screen the page column narrows to make room (the
  // shell reads this flag), so the record or list stays usable while asking.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.assistantDock = "open";
    return () => {
      delete root.dataset.assistantDock;
    };
  }, [open]);
  const editorDraft = useEditorDraft();
  const capture = useRef<FilterRule | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<FilterRule>();
  const [keyboardHeight, setKeyboardHeight] = useState<number>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport || window.innerWidth > 600) return;
    const resize = () => setKeyboardHeight(viewport.height);
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [open]);
  const captureDraft = () => {
    capture.current = editorDraft?.current;
  };
  const openPanel = () => {
    setCompose(!props.assistant);
    setSnapshot(capture.current ?? editorDraft?.current);
    capture.current = undefined;
    setOpen(true);
  };
  const activeKey = sessionKey(tenantCode, memberId ?? "", "active");
  const conversationId = useAssistantSession(activeKey) ?? undefined;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!conversationId || url.searchParams.get("assistant") !== conversationId)
      return;
    url.searchParams.delete("assistant");
    window.history.replaceState(window.history.state, "", url);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
  }, [conversationId]);
  const page: AssistantPageContext = {
    hint: {
      objectCode,
      ...(recordId ? { recordId } : {}),
      ...(viewId ? { viewId } : {}),
    },
    objectName,
    label: [objectName, recordTitle ?? viewName].filter(Boolean).join(" · "),
    filterDraft: snapshot ?? rule,
    applyFilter: onApply,
    describeRule,
  };
  return (
    <>
      <Button
        icon={<AiSparkIcon aria-hidden />}
        aria-label={props.assistant ? "打开助手" : "打开帮我写"}
        onPointerDown={captureDraft}
        onKeyDown={captureDraft}
        onClick={openPanel}
      >
        <span className={panelStyles.triggerLabel}>
          {props.assistant ? "助手" : "帮我写"}
        </span>
      </Button>
      <Drawer
        title={
          compose ? (
            <Space>
              {props.assistant && (
                <Button
                  type="text"
                  aria-label="返回助手"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setCompose(false)}
                />
              )}
              {[recordTitle, "帮我写"].filter(Boolean).join(" · ")}
            </Space>
          ) : null
        }
        closable={compose && { placement: "end" }}
        placement="right"
        open={open}
        onClose={() => setOpen(false)}
        aria-label="页面助手"
        destroyOnHidden
        mask={false}
        focusable={{ trap: false }}
        rootClassName={panelStyles.dock}
        size="min(400px, 100vw)"
        styles={{
          body: {
            padding: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          },
          section: { maxHeight: keyboardHeight ?? "100dvh" },
        }}
      >
        {props.writing && recordId && compose && (
          <SalesWriting
            tenantCode={tenantCode}
            objectCode={objectCode}
            recordId={recordId}
          />
        )}
        {!compose && props.assistant && (
          <AiAssistantPage
            key={objectCode + ":" + (recordId ?? "")}
            tenantCode={tenantCode}
            memberId={memberId}
            businessObjects={[]}
            panel={{
              page,
              conversationId,
              select: (id) => writeAssistantSession(activeKey, id),
              close: () => setOpen(false),
              actions: props.writing && recordId && (
                <Button
                  type="text"
                  icon={<EditOutlined aria-hidden />}
                  onClick={() => setCompose(true)}
                >
                  帮我写
                </Button>
              ),
            }}
          />
        )}
      </Drawer>
    </>
  );
}

export function ListAssistantButton({
  view,
  ready,
  filter,
  ...props
}: Pick<PanelProps, "tenantCode" | "memberId" | "objectCode" | "objectName"> & {
  view?: { id: string; name: string };
  ready: boolean;
  filter: RecordFilterPanelProps;
}) {
  return (
    <AssistantPanelButton
      {...props}
      viewId={view?.id}
      viewName={view?.name}
      rule={filter.rule}
      onApply={ready ? filter.onApply : undefined}
      describeRule={(rule) => describeRecordFilter(rule, filter)}
    />
  );
}
