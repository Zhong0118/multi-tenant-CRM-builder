"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";

import { toApiError, type FieldErrors } from "@/lib/api/api-error";

import type { ObjectDraft } from "./object-types";
import { objectApi as defaultObjectApi, type ObjectApi } from "./object-api";
import {
  WorkflowActionEditor,
  actionFieldErrors,
  actionTargetObjects,
} from "./workflow-action-editor";
import {
  workflowApi as defaultWorkflowApi,
  type WorkflowApi,
} from "./workflow-api";
import type {
  WorkflowDraft,
  WorkflowRole,
  WorkflowStateDraft,
  WorkflowTransitionDraft,
} from "./workflow-types";
import { WORKFLOW_ROLES } from "./workflow-types";

import styles from "./workflow-configuration.module.css";

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

export function WorkflowDesigner(props: WorkflowDesignerProps) {
  return (
    <WorkflowDesignerForm
      key={`${props.tenantCode}:${props.draft.object.id}`}
      {...props}
    />
  );
}

function WorkflowDesignerForm({
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
  const [localForm, setForm] = useState<WorkflowDraft>();
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

  // Once editing starts, background refetches must not replace local input.
  const form = localForm ?? query.data;

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
      queryClient.setQueryData(queryKey, saved);
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

  if (query.isError && !form) {
    const failure = toApiError(query.error);
    return (
      <Alert
        type="error"
        showIcon
        title={`无法载入流程配置：${failure.message}（请求编号：${failure.requestId}）`}
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  if (!form) {
    return (
      <Typography.Text type="secondary">正在载入流程配置…</Typography.Text>
    );
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
    <Form component={false} disabled={save.isPending}>
      <fieldset
        disabled={save.isPending}
        style={{ border: 0, margin: 0, padding: 0 }}
      >
        <section className={styles.panel}>
        <div className={styles.sectionHeading}>
        <div>
          <h2>流程</h2>
          <Typography.Text type="secondary">
            当前编辑：{draft.object.name} · 流程草稿
          </Typography.Text>
        </div>
        <Space>
          <span>启用流程</span>
          <Switch
            aria-label="启用流程"
            checked={form.isEnabled}
            onChange={(isEnabled) => setForm({ ...form, isEnabled })}
          />
        </Space>
      </div>

      {notice ? <Alert type="success" showIcon title={notice} /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}

      <section className={styles.configurationSection} aria-label="状态">
        <h3>状态</h3>
        <Typography.Text type="secondary">
          初始状态是流程起点；终止状态不再提供后续动作。
        </Typography.Text>
        {form.states.map((state, index) => (
          <div key={`state-${index}`} className={styles.stateRow}>
            <label className={styles.control}>
              <span>状态名称</span>
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
            </label>
            <label className={styles.control}>
              <span>状态编码</span>
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
            </label>
            <label className={styles.toggle}>
              <span>初始状态</span>
              <Switch
                aria-label={`初始状态 ${index + 1}`}
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
            </label>
            <label className={styles.toggle}>
              <span>终止状态</span>
              <Switch
                aria-label={`终止状态 ${index + 1}`}
                checked={state.isTerminal}
                checkedChildren="终态"
                unCheckedChildren="终态"
                onChange={(isTerminal) =>
                  setForm({
                    ...form,
                    states: replaceAt(form.states, index, {
                      ...state,
                      isTerminal,
                    }),
                  })
                }
              />
            </label>
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
              states: [...form.states, emptyState(form.states.length)],
            })
          }
        >
          添加状态
        </Button>
      </section>
      <section className={styles.configurationSection} aria-label="可执行动作">
        <h3>可执行动作</h3>
        <Typography.Text type="secondary">
          配置状态流转、允许执行的角色和执行前必填字段。
        </Typography.Text>
        {objectListError ? (
          <Alert type="error" showIcon title={objectListError} />
        ) : null}
        {form.transitions.map((transition, index) => (
          <div key={`transition-${index}`} className={styles.transition}>
            <h4>{transition.label || `动作 ${index + 1}`}</h4>
            <div className={styles.transitionFields}>
              <label className={styles.control}>
                <span>动作名称</span>
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
              </label>
              <label className={styles.control}>
                <span>动作编码</span>
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
              </label>
              <label className={styles.control}>
                <span>从状态</span>
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
              </label>
              <label className={styles.control}>
                <span>到状态</span>
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
              </label>
              <label className={styles.control}>
                <span>允许角色</span>
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
              </label>
              <label className={styles.control}>
                <span>必填字段</span>
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
              </label>
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
            </div>
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
      </section>

      {form.transitions.some((transition) =>
        terminalKeys.has(transition.fromStateKey),
      ) ? (
        <Alert type="warning" showIcon title="终态不能作为动作的起始状态。" />
      ) : null}

      <div className={styles.saveBar}>
        <Typography.Text type="secondary">
          保存仅更新流程草稿；发布业务表后，员工才会使用新的状态、可执行动作和执行步骤。
        </Typography.Text>
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() => save.mutate(form)}
        >
          保存流程
        </Button>
        </div>
        </section>
      </fieldset>
    </Form>
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
