"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  ConfigProvider,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  DownOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";

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
  /** Reports whether the form holds edits that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void;
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
  onDirtyChange,
}: WorkflowDesignerProps) {
  const readOnly = draft.object.status === "ARCHIVED";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string>();
  const [localForm, setLocalForm] = useState<WorkflowDraft>();
  const [openTransition, setOpenTransition] = useState<number | null>(null);
  const setForm = (next: WorkflowDraft) => {
    if (!readOnly) setLocalForm(next);
  };
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
  // Compared on what the form edits, in a fixed shape: the server adds keys
  // (descriptions, the object version) that are not edits.
  const dirty =
    localForm !== undefined &&
    query.data !== undefined &&
    workflowSignature(localForm) !== workflowSignature(query.data);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = useMutation({
    mutationFn: (current: WorkflowDraft) =>
      api.saveDraft(tenantCode, draft.object.id, {
        expectedDraftRevision: draft.object.version,
        isEnabled: current.isEnabled,
        initialStateKey: current.initialStateKey,
        states: current.states,
        transitions: current.transitions,
      }),
    onSuccess: async (saved) => {
      setForm(saved);
      setNotice("流程配置已保存");
      setError(undefined);
      setFieldErrors({});
      queryClient.setQueryData(queryKey, saved);
      onObjectVersion({
        ...draft,
        object: {
          ...draft.object,
          version: saved.objectVersion,
          hasUnpublishedChanges: true,
        },
      });
      try {
        const current = await objectApi.draft(tenantCode, draft.object.id);
        if (current.object.version === saved.objectVersion) {
          onObjectVersion(current);
        } else {
          setNotice(
            "流程配置已保存，但配置已被其他管理员更新，请重新载入配置后继续编辑",
          );
        }
      } catch {
        setNotice("流程配置已保存，但发布状态读取失败，请重新载入配置核对");
      }
    },
    onError: (caught) => {
      const apiError = toApiError(caught);
      setNotice(undefined);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
      // §34: the envelope message is generic; the located reason only exists in
      // the field errors, so they are kept for the Action editor to render.
      setFieldErrors(apiError.fieldErrors);
      const first = Object.keys(apiError.fieldErrors)
        .map((path) => /^transitions\.(\d+)\./.exec(path)?.[1])
        .find((index) => index !== undefined);
      if (first !== undefined) setOpenTransition(Number(first));
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

  const locked = readOnly || save.isPending;
  const stateName = (key: string) => {
    const state = form.states.find((item) => item.key === key);
    return state ? state.label || state.key || "未命名状态" : key || "未选择";
  };
  const openIndex = openTransition;

  function showTransition(index: number) {
    setOpenTransition(index);
    requestAnimationFrame(() =>
      document
        .getElementById(`workflow-transition-${index}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }

  return (
    <ConfigProvider componentDisabled={locked}>
      <Form component={false} disabled={locked}>
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

          <WorkflowMap
            form={form}
            stateName={stateName}
            openIndex={openIndex}
            onSelect={showTransition}
          />

          <section className={styles.configurationSection} aria-label="状态">
            <div className={styles.blockHead}>
              <h3>状态</h3>
              <Typography.Text type="secondary">
                初始状态是流程起点；终止状态不再提供后续动作。
              </Typography.Text>
            </div>
            <fieldset disabled={locked} className={styles.fieldset}>
              {form.states.length ? (
                <div
                  className={styles.stateTable}
                  role="table"
                  aria-label="状态列表"
                >
                  <div className={styles.stateHead} role="row">
                    <span role="columnheader">状态名称</span>
                    <span role="columnheader">状态编码</span>
                    <span role="columnheader">初始状态</span>
                    <span role="columnheader">终止状态</span>
                    <span role="columnheader" className={styles.srOnly}>
                      操作
                    </span>
                  </div>
                  {form.states.map((state, index) => (
                    <div
                      key={`state-${index}`}
                      className={styles.stateRow}
                      role="row"
                    >
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
                      <span role="cell">
                        <Switch
                          size="small"
                          aria-label={`初始状态 ${index + 1}`}
                          checked={
                            form.initialStateKey === state.key &&
                            state.key !== ""
                          }
                          checkedChildren="初始"
                          unCheckedChildren="初始"
                          onChange={(checked) =>
                            setForm({
                              ...form,
                              initialStateKey: checked
                                ? state.key
                                : form.initialStateKey,
                            })
                          }
                        />
                      </span>
                      <span role="cell">
                        <Switch
                          size="small"
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
                      </span>
                      <span role="cell">
                        <Button
                          type="text"
                          danger
                          size="small"
                          aria-label={`删除状态 ${state.label || index + 1}`}
                          onClick={() =>
                            setForm({
                              ...form,
                              states: form.states.filter(
                                (_, current) => current !== index,
                              ),
                            })
                          }
                        >
                          删除
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>
                  还没有状态。先添加流程的起点，再添加后续状态。
                </p>
              )}
              <Button
                icon={<PlusOutlined aria-hidden />}
                className={styles.addButton}
                onClick={() =>
                  setForm({
                    ...form,
                    states: [...form.states, emptyState(form.states.length)],
                  })
                }
              >
                添加状态
              </Button>
            </fieldset>
          </section>

          <section
            className={styles.configurationSection}
            aria-label="可执行动作"
          >
            <div className={styles.blockHead}>
              <h3>可执行动作</h3>
              <Typography.Text type="secondary">
                配置状态流转、允许执行的角色和执行前必填字段；展开一个动作编辑它的执行步骤。
              </Typography.Text>
            </div>
            {objectListError ? (
              <Alert type="error" showIcon title={objectListError} />
            ) : null}
            {form.transitions.length === 0 ? (
              <p className={styles.empty}>
                还没有可执行动作。动作让记录从一个状态进入另一个状态，并可附带创建记录、分配负责人等步骤。
              </p>
            ) : null}
            {form.transitions.map((transition, index) => {
              const open = openIndex === index;
              return (
                <div
                  key={`transition-${index}`}
                  id={`workflow-transition-${index}`}
                  className={styles.transition}
                  data-open={open || undefined}
                >
                  <button
                    type="button"
                    className={styles.transitionSummary}
                    aria-expanded={open}
                    aria-controls={`workflow-transition-body-${index}`}
                    // Expanding is navigation, not editing: it stays usable
                    // while a save is pending and on archived tables.
                    disabled={false}
                    onClick={() => setOpenTransition(open ? null : index)}
                  >
                    <DownOutlined aria-hidden className={styles.chevron} />
                    <strong>{transition.label || `动作 ${index + 1}`}</strong>
                    <span className={styles.route}>
                      {stateName(transition.fromStateKey)}
                      <ArrowRightOutlined aria-hidden />
                      {stateName(transition.toStateKey)}
                    </span>
                    <span className={styles.summaryMeta}>
                      {transition.allowedRoles
                        .map((role) => ROLE_LABELS[role])
                        .join("、") || "没有角色可执行"}
                      {transition.requiredFieldKeys.length
                        ? ` · 执行前必填 ${transition.requiredFieldKeys.length} 个字段`
                        : ""}
                      {` · ${transition.actions.length ? `${transition.actions.length} 个执行步骤` : "只改变状态"}`}
                    </span>
                  </button>
                  {open ? (
                    <fieldset
                      disabled={locked}
                      id={`workflow-transition-body-${index}`}
                      className={`${styles.fieldset} ${styles.transitionBody}`}
                    >
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
                                transitions: replaceAt(
                                  form.transitions,
                                  index,
                                  {
                                    ...transition,
                                    label: event.target.value,
                                  },
                                ),
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
                                transitions: replaceAt(
                                  form.transitions,
                                  index,
                                  {
                                    ...transition,
                                    key: event.target.value,
                                  },
                                ),
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
                            options={form.states
                              .filter((state) => !state.isTerminal)
                              .map((state) => ({
                                value: state.key,
                                label: state.label || state.key,
                              }))}
                            onChange={(fromStateKey: string) =>
                              setForm({
                                ...form,
                                transitions: replaceAt(
                                  form.transitions,
                                  index,
                                  {
                                    ...transition,
                                    fromStateKey,
                                  },
                                ),
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
                            options={form.states.map((state) => ({
                              value: state.key,
                              label: state.label || state.key,
                            }))}
                            onChange={(toStateKey: string) =>
                              setForm({
                                ...form,
                                transitions: replaceAt(
                                  form.transitions,
                                  index,
                                  {
                                    ...transition,
                                    toStateKey,
                                  },
                                ),
                              })
                            }
                          />
                        </label>
                        <label className={`${styles.control} ${styles.wide}`}>
                          <span>允许角色</span>
                          <Select
                            mode="multiple"
                            aria-label={`允许角色 ${index + 1}`}
                            value={transition.allowedRoles}
                            options={WORKFLOW_ROLES.map((role) => ({
                              value: role,
                              label: ROLE_LABELS[role],
                            }))}
                            onChange={(allowedRoles: WorkflowRole[]) =>
                              setForm({
                                ...form,
                                transitions: replaceAt(
                                  form.transitions,
                                  index,
                                  {
                                    ...transition,
                                    allowedRoles,
                                  },
                                ),
                              })
                            }
                          />
                        </label>
                        <label className={`${styles.control} ${styles.wide}`}>
                          <span>必填字段</span>
                          <Select
                            mode="multiple"
                            aria-label={`必填字段 ${index + 1}`}
                            value={transition.requiredFieldKeys}
                            placeholder="执行前必须填写的字段"
                            options={fieldOptions}
                            onChange={(requiredFieldKeys: string[]) =>
                              setForm({
                                ...form,
                                transitions: replaceAt(
                                  form.transitions,
                                  index,
                                  {
                                    ...transition,
                                    requiredFieldKeys,
                                  },
                                ),
                              })
                            }
                          />
                        </label>
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
                      <div className={styles.transitionFoot}>
                        <Button
                          danger
                          type="text"
                          onClick={() => {
                            setForm({
                              ...form,
                              transitions: form.transitions.filter(
                                (_, current) => current !== index,
                              ),
                            });
                            setOpenTransition(null);
                          }}
                        >
                          删除动作
                        </Button>
                      </div>
                    </fieldset>
                  ) : null}
                </div>
              );
            })}
            <Button
              icon={<PlusOutlined aria-hidden />}
              className={styles.addButton}
              onClick={() => {
                setForm({
                  ...form,
                  transitions: [
                    ...form.transitions,
                    emptyTransition(form.transitions.length, form.states),
                  ],
                });
                setOpenTransition(form.transitions.length);
              }}
            >
              添加动作
            </Button>
          </section>
          {form.transitions.some((transition) =>
            terminalKeys.has(transition.fromStateKey),
          ) ? (
            <Alert
              type="warning"
              showIcon
              title="终态不能作为动作的起始状态。"
            />
          ) : null}
          <div className={styles.saveBar}>
            <Typography.Text type="secondary">
              保存仅更新流程草稿；发布业务表后，员工才会使用新的状态、可执行动作和执行步骤。
            </Typography.Text>
            {dirty ? (
              <span className={styles.unsaved}>有未保存的修改</span>
            ) : null}
            <Button
              type="primary"
              loading={save.isPending}
              onClick={() => {
                if (!readOnly) save.mutate(form);
              }}
            >
              保存流程
            </Button>
          </div>
        </section>
      </Form>
    </ConfigProvider>
  );
}

/**
 * The workflow at a glance: every state in order with the actions that leave
 * it, so 从哪里 → 做什么 → 到哪里 reads left to right. Choosing an action opens
 * its editor below. States nothing leads to, and states that lead nowhere
 * without being terminal, are flagged, since records would never reach or
 * never leave them.
 */
function WorkflowMap({
  form,
  stateName,
  openIndex,
  onSelect,
}: {
  form: WorkflowDraft;
  stateName: (key: string) => string;
  openIndex: number | null;
  onSelect: (index: number) => void;
}) {
  if (form.states.length === 0) return null;
  return (
    <figure className={styles.map} aria-label="流程图">
      <figcaption>流程图 · 点击动作查看和编辑</figcaption>
      <ol className={styles.mapLanes}>
        {form.states.map((state, stateIndex) => {
          const outgoing = form.transitions
            .map((transition, index) => ({ transition, index }))
            .filter(
              ({ transition }) =>
                transition.fromStateKey === state.key && state.key,
            );
          const initial =
            form.initialStateKey === state.key && state.key !== "";
          const reached =
            initial ||
            form.transitions.some(
              (transition) => transition.toStateKey === state.key,
            );
          return (
            <li key={`map-${stateIndex}`} className={styles.mapLane}>
              <div
                className={styles.mapState}
                data-initial={initial || undefined}
                data-terminal={state.isTerminal || undefined}
              >
                <strong>{stateName(state.key)}</strong>
                <span className={styles.mapBadges}>
                  {initial ? <span data-badge="start">起点</span> : null}
                  {state.isTerminal ? <span data-badge="end">终点</span> : null}
                </span>
              </div>
              {outgoing.length ? (
                <ul className={styles.mapEdges}>
                  {outgoing.map(({ transition, index }) => (
                    <li key={index}>
                      <button
                        type="button"
                        className={styles.mapEdge}
                        aria-pressed={openIndex === index}
                        disabled={false}
                        onClick={() => onSelect(index)}
                      >
                        <span>{transition.label || `动作 ${index + 1}`}</span>
                        <span className={styles.mapTarget}>
                          <ArrowRightOutlined aria-hidden />
                          {stateName(transition.toStateKey)}
                        </span>
                        {transition.actions.length ? (
                          <small>{transition.actions.length} 个执行步骤</small>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : state.isTerminal ? null : (
                <p className={styles.mapWarning}>
                  没有可执行动作，记录会停在这里
                </p>
              )}
              {!reached ? (
                <p className={styles.mapWarning}>没有动作进入这个状态</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function workflowSignature(form: WorkflowDraft): string {
  return JSON.stringify([
    form.isEnabled,
    form.initialStateKey ?? null,
    form.states.map((state) => [
      state.key,
      state.label,
      state.isTerminal,
      state.sortOrder,
    ]),
    form.transitions.map((transition) => [
      transition.key,
      transition.label,
      transition.fromStateKey,
      transition.toStateKey,
      transition.allowedRoles,
      transition.requiredFieldKeys,
      transition.sortOrder,
      JSON.stringify(transition.actions, sortedKeys),
    ]),
  ]);
}

/** A JSON replacer that writes object keys in sorted order. */
function sortedKeys(_key: string, value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      )
    : value;
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
