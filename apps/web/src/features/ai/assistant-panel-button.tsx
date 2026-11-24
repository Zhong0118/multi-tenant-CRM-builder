"use client";

import { SalesWriting } from "./sales-writing";
import { useAiFeature } from "@/features/ai-governance/access";
import { RobotOutlined } from "@ant-design/icons";
import { Button, Drawer } from "antd";
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
        icon={<RobotOutlined aria-hidden />}
        aria-label={props.assistant ? "打开助手" : "打开帮我写"}
        onPointerDown={captureDraft}
        onKeyDown={captureDraft}
        onClick={openPanel}
      >
        {props.assistant ? "助手" : "帮我写"}
      </Button>
      <Drawer
        title={
          compose ? [recordTitle, "帮我写"].filter(Boolean).join(" · ") : null
        }
        closable={compose}
        placement="right"
        open={open}
        onClose={() => setOpen(false)}
        aria-label="页面助手"
        destroyOnHidden
        size="min(480px, 100vw)"
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
        {props.writing &&
          recordId &&
          (compose ? (
            <>
              {props.assistant && (
                <Button type="text" onClick={() => setCompose(false)}>
                  返回助手
                </Button>
              )}
              <SalesWriting
                tenantCode={tenantCode}
                objectCode={objectCode}
                recordId={recordId}
              />
            </>
          ) : (
            <Button onClick={() => setCompose(true)}>帮我写</Button>
          ))}
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
