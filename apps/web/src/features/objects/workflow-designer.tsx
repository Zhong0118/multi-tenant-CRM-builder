"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Select, Space, Switch, Typography } from "antd";
import { useEffect, useState } from "react";

import { toApiError, type FieldErrors } from "@/lib/api/api-error";

import type { ObjectDraft } from "./object-types";
import { objectApi as defaultObjectApi, type ObjectApi } from "./object-api";
import {
  WorkflowActionEditor,
  actionFieldErrors,
  actionTargetObjects,
} from "./workflow-action-editor";
import { workflowApi as defaultWorkflowApi, type WorkflowApi } from "./workflow-api";
import type {
  WorkflowDraft,
  WorkflowRole,
  WorkflowStateDraft,
  WorkflowTransitionDraft,
} from "./workflow-types";
import { WORKFLOW_ROLES } from "./workflow-types";

import styles from "./objects.module.css";

const ROLE_LABELS: Record<WorkflowRole, string> = {
  TENANT_ADMIN: "公司管理员",
  EMPLOYEE: "员工",
};

export interface WorkflowDesignerProps {
  tenantCode: string;
  draft: ObjectDraft;
  onObjectVersion: (next: ObjectDraft) => void;
  api?: WorkflowApi;
  /**
   * Existing admin object API. The Action editor reads every Target Object's
   * field metadata from its list endpoint (`listDrafts`), so no new endpoint is
   * added for the Action Editor.
   */
  objectApi?: ObjectApi;
}

export function WorkflowDesigner({
  tenantCode,
  draft,
  onObjectVersion,
  api = defaultWorkflowApi,
  objectApi = defaultObjectApi,
}: WorkflowDesignerProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState<WorkflowDraft>();
  const queryKey = ["workspace", tenantCode, "workflow-draft", draft.object.id];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getDraft(tenantCode, draft.object.id),
  });

  // §33: the CREATE_RECORD editor needs each Target Object's fields. The object
  // list is an existing administrative endpoint; the shared query key lets the
  // object designer's own invalidation refresh it after a publication.
  const objectsQuery = useQuery({
    queryKey: ["workspace", tenantCode, "object-definitions"],
    queryFn: () => objectApi.listDrafts(tenantCode),
  });

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (current: WorkflowDraft) =>
      api.saveDraft(tenantCode, draft.object.id, {
        expectedDraftRevision: draft.object.version,
        isEnabled: current.isEnabled,
        initialStateKey: current.initialStateKey,
        states: current.states,
        transitions: current.transitions,
      }),
    onSuccess: (saved) => {
      setForm(saved);
      setNotice("流程配置已保存");
      setError(undefined);
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey });
      onObjectVersion({
        ...draft,
        object: { ...draft.object, version: saved.objectVersion },
      });
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setNotice(undefined);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
      // §34: the envelope message is generic; the located reason only exists in
      // the field errors, so they are kept for the Action editor to render.
      setFieldErrors(apiError.fieldErrors);
    },
  });

  if (query.isPending || !form) {
    return <Typography.Text type="secondary">正在载入流程配置…</Typography.Text>;
  }

  const terminalKeys = new Set(
    form.states.filter((state) => state.isTerminal).map((state) => state.key),
  );
  // §19/§22: the Action editor reads the same fields, with their types — the
  // pending publication freezes this draft's own ACTIVE fields, so the draft
  // type (not the published type) is what a mapping must match.
  const sourceFields = draft.fields
    .filter((field) => field.status === "ACTIVE")
    .map((field) => ({
      fieldKey: field.fieldKey,
      label: field.label,
      type: field.type,
    }));
  const fieldOptions = sourceFields.map((field) => ({
    value: field.fieldKey,
    label: field.label,
  }));
  const targetObjects = actionTargetObjects(objectsQuery.data ?? [], draft);
  // §33: without this list the CREATE_RECORD 目标业务表 select is simply empty.
  // A failed query has to say so, in the same shape as every other API failure
  // the designer reports, instead of looking like "no objects exist yet".
  const objectsFailure = objectsQuery.isError
    ? toApiError(objectsQuery.error)
    : undefined;
  const objectListError =
    objectsFailure === undefined
      ? undefined
      : `无法载入目标业务表列表：${objectsFailure.message}（请求编号：${objectsFailure.requestId}）`;

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>流程</h2>
          <Typography.Text type="secondary">
            保存后仍是草稿；发布业务表后，员工才会看到新的流程状态。
          </Typography.Text>
        </div>
        <Space>
          <span>启用流程</span>
          <Switch
            checked={form.isEnabled}
            onChange={(isEnabled) => setForm({ ...form, isEnabled })}
          />
        </Space>
      </div>

      {notice ? <Alert type="success" showIcon title={notice} /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}

      <Typography.Text type="secondary">状态</Typography.Text>
      {form.states.map((state, index) => (
        <div key={`state-${index}`} className={styles.designerMeta}>
          <Input
            aria-label={`状态名称 ${index + 1}`}
            value={state.label}
            placeholder="状态名称"
            onChange={(event) =>
              setForm({
                ...form,
                states: replaceAt(form.states, index, {
                  ...state,
                  label: event.target.value,
                }),
              })
            }
          />
          <Input
            aria-label={`状态编码 ${index + 1}`}
            value={state.key}
            placeholder="状态编码"
            onChange={(event) =>
              setForm({
                ...form,
                states: replaceAt(form.states, index, {
                  ...state,
                  key: event.target.value,
                }),
              })
            }
          />
          <Switch
            checked={form.initialStateKey === state.key && state.key !== ""}
            checkedChildren="初始"
            unCheckedChildren="初始"
            onChange={(checked) =>
              setForm({
                ...form,
                initialStateKey: checked ? state.key : form.initialStateKey,
              })
            }
          />
          <Switch
            checked={state.isTerminal}
            checkedChildren="终态"
            unCheckedChildren="终态"
            onChange={(isTerminal) =>
              setForm({
                ...form,
                states: replaceAt(form.states, index, { ...state, isTerminal }),
              })
            }
          />
          <Button
            onClick={() =>
              setForm({
                ...form,
                states: form.states.filter((_, current) => current !== index),
              })
            }
          >
            删除状态
          </Button>
        </div>
      ))}
      <Button
        onClick={() =>
          setForm({
            ...form,
            states: [
              ...form.states,
              emptyState(form.states.length),
            ],
          })
        }
      >
        添加状态
      </Button>

      <Typography.Text type="secondary">动作</Typography.Text>
      {objectListError ? (
        <Alert type="error" showIcon title={objectListError} />
      ) : null}
      {form.transitions.map((transition, index) => (
        <div key={`transition-${index}`} className={styles.designerMeta}>
          <Input
            aria-label={`动作名称 ${index + 1}`}
            value={transition.label}
            placeholder="动作名称"
            onChange={(event) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  label: event.target.value,
                }),
              })
            }
          />
          <Input
            aria-label={`动作编码 ${index + 1}`}
            value={transition.key}
            placeholder="动作编码"
            onChange={(event) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  key: event.target.value,
                }),
              })
            }
          />
          <Select
            aria-label={`从状态 ${index + 1}`}
            value={transition.fromStateKey || undefined}
            placeholder="从"
            style={{ minWidth: 120 }}
            options={form.states
              .filter((state) => !state.isTerminal)
              .map((state) => ({
                value: state.key,
                label: state.label || state.key,
              }))}
            onChange={(fromStateKey: string) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  fromStateKey,
                }),
              })
            }
          />
          <Select
            aria-label={`到状态 ${index + 1}`}
            value={transition.toStateKey || undefined}
            placeholder="到"
            style={{ minWidth: 120 }}
            options={form.states.map((state) => ({
              value: state.key,
              label: state.label || state.key,
            }))}
            onChange={(toStateKey: string) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  toStateKey,
                }),
              })
            }
          />
          <Select
            mode="multiple"
            aria-label={`允许角色 ${index + 1}`}
            value={transition.allowedRoles}
            style={{ minWidth: 180 }}
            options={WORKFLOW_ROLES.map((role) => ({
              value: role,
              label: ROLE_LABELS[role],
            }))}
            onChange={(allowedRoles: WorkflowRole[]) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  allowedRoles,
                }),
              })
            }
          />
          <Select
            mode="multiple"
            aria-label={`必填字段 ${index + 1}`}
            value={transition.requiredFieldKeys}
            style={{ minWidth: 180 }}
            options={fieldOptions}
            onChange={(requiredFieldKeys: string[]) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  requiredFieldKeys,
                }),
              })
            }
          />
          <Button
            onClick={() =>
              setForm({
                ...form,
                transitions: form.transitions.filter(
                  (_, current) => current !== index,
                ),
              })
            }
          >
            删除动作
          </Button>
          <WorkflowActionEditor
            transitionIndex={index}
            actions={transition.actions}
            errors={actionFieldErrors(fieldErrors, index)}
            sourceFields={sourceFields}
            targetObjects={targetObjects}
            onChange={(actions) =>
              setForm({
                ...form,
                transitions: replaceAt(form.transitions, index, {
                  ...transition,
                  actions,
                }),
              })
            }
          />
        </div>
      ))}
      <Button
        onClick={() =>
          setForm({
            ...form,
            transitions: [
              ...form.transitions,
              emptyTransition(form.transitions.length, form.states),
            ],
          })
        }
      >
        添加动作
      </Button>

      {form.transitions.some((transition) =>
        terminalKeys.has(transition.fromStateKey),
      ) ? (
        <Alert type="warning" showIcon title="终态不能作为动作的起始状态。" />
      ) : null}

      <div>
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() => save.mutate(form)}
        >
          保存流程
        </Button>
      </div>
    </section>
  );
}

function emptyState(index: number): WorkflowStateDraft {
  return {
    key: "",
    label: "",
    sortOrder: (index + 1) * 10,
    isTerminal: false,
  };
}

function emptyTransition(
  index: number,
  states: WorkflowStateDraft[],
): WorkflowTransitionDraft {
  const from = states.find((state) => !state.isTerminal)?.key ?? "";
  return {
    key: "",
    label: "",
    fromStateKey: from,
    toStateKey: states[0]?.key ?? "",
    allowedRoles: ["TENANT_ADMIN", "EMPLOYEE"],
    requiredFieldKeys: [],
    sortOrder: (index + 1) * 10,
    /** §35: a transition without Actions stays a state-only transition. */
    actions: [],
  };
}

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, current) => (current === index ? next : item));
}
