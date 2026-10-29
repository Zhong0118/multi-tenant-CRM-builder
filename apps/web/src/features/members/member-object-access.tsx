"use client";

import { DownOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Segmented, Select, Switch } from "antd";
import Link from "next/link";
import { useId, useState } from "react";

import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { StatusTag } from "@/components/workbench/status-tag";
import {
  DATA_SCOPE_LABELS,
  type PublishedFieldAccess,
} from "@/features/objects/object-types";
import { toApiError } from "@/lib/api/api-error";

import { BulkMemberAccess, FIELD_ACCESS_LABELS } from "./bulk-member-access";
import styles from "./members.module.css";

export type {
  MemberAccessApi,
  MemberObjectAccessRow,
  MemberObjectPolicy,
  MemberObjectAccessInput,
} from "./member-access-api";
export { memberAccessApi } from "./member-access-api";
import {
  memberAccessApi,
  MEMBER_READ_SCOPE_LABELS,
  type MemberAccessApi,
  type MemberObjectAccessRow,
  type MemberObjectPolicy,
  type MemberObjectAccessInput,
} from "./member-access-api";

export interface MemberObjectAccessProps {
  tenantCode: string;
  memberId: string;
  memberName: string;
  isGroupLeader?: boolean;
  groupName?: string | null;
  initialRows: MemberObjectAccessRow[];
  api?: MemberAccessApi;
}

type Field = MemberObjectAccessRow["fields"][number];

/** Fields whose access this member holds as an exception to the default. */
function fieldExceptions(row: MemberObjectAccessRow) {
  return (row.fields ?? []).filter((field) => !field.isSystem && field.override)
    .length;
}

/**
 * One employee's access, table by table. Each table either follows the
 * published employee default, set in the business-table designer, or carries
 * a member exception that replaces it entirely and applies at once — there is
 * no partial exception, because a half-applied policy could not be reasoned
 * about. Column exceptions are edited through the shared access drawer.
 */
export function MemberObjectAccess({
  tenantCode,
  memberId,
  memberName,
  isGroupLeader = false,
  groupName,
  initialRows,
  api = memberAccessApi,
}: MemberObjectAccessProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(initialRows);
  // The outcome of the last save, shown in the row it changed.
  const [feedback, setFeedback] = useState<Feedback>();
  const [show, setShow] = useState<"all" | "exceptions">("all");
  const save = useMutation({
    mutationFn: ({
      objectId,
      input,
    }: {
      objectId: string;
      input: MemberObjectAccessInput;
    }) => api.set(tenantCode, memberId, objectId, input),
    onMutate: () => setFeedback(undefined),
    onSuccess: (updated) => {
      setRows((current) =>
        current.map((row) =>
          row.objectId === updated.objectId ? updated : row,
        ),
      );
      setFeedback({
        objectId: updated.objectId,
        tone: "success",
        text:
          updated.mode === "INHERIT"
            ? `${updated.objectName}已恢复为员工默认权限，立即生效`
            : `${updated.objectName}的成员例外已保存，立即生效`,
      });
      void queryClient.invalidateQueries({
        queryKey: ["workspace", tenantCode, "members"],
        exact: false,
      });
    },
    onError: (caught, { objectId }) => {
      const apiError = toApiError(caught);
      setFeedback({
        objectId,
        tone: "error",
        text: `${apiError.message}（请求编号：${apiError.requestId}）`,
      });
    },
  });

  if (rows.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        title="公司还没有已发布的业务表。"
        description="先在设置中配置并发布业务表，再回来调整成员访问权限。"
        action={
          <Link href={`/workspace/${tenantCode}/settings/objects`}>
            去业务表
          </Link>
        }
      />
    );
  }

  const withExceptions = rows.filter(
    (row) =>
      row.mode === "OVERRIDE" ||
      fieldExceptions(row) > 0 ||
      Boolean(row.effective.groupFieldAccess),
  );
  const visible = show === "all" ? rows : withExceptions;

  return (
    <div className={styles.accessList}>
      {isGroupLeader ? (
        <Alert
          type="info"
          showIcon
          title={`${groupName ?? "本组"} · 组长`}
          description="公司管理员可按业务表授予查看本组成员名下记录的权限，并单独设置本组其他成员记录的列权限。本人记录保持原有列权限。"
        />
      ) : null}
      <div className={styles.accessSources} aria-label="权限来源">
        <section>
          <h2>
            员工默认 <span className={styles.sourceEffect}>发布后生效</span>
          </h2>
          <p>
            在业务表设计器中设置，对所有员工生效，修改后要发布业务表。
            <Link href={`/workspace/${tenantCode}/settings/objects`}>
              去业务表
            </Link>
          </p>
        </section>
        <section data-source="exception">
          <h2>
            成员例外 <span className={styles.sourceEffect}>保存即生效</span>
          </h2>
          <p>
            只对{memberName}
            生效，替换这张表的员工默认，保存后立即生效，无需发布。
          </p>
        </section>
      </div>

      <div className={styles.accessSummary}>
        <Segmented
          aria-label="显示的业务表"
          value={show}
          onChange={(value) => setShow(value as "all" | "exceptions")}
          options={[
            { value: "all", label: `全部 ${rows.length}` },
            { value: "exceptions", label: `有例外 ${withExceptions.length}` },
          ]}
        />
        <span>员工不能删除记录；管理员不受这里的设置限制。</span>
      </div>

      {visible.length === 0 ? (
        <p className={styles.accessEmpty}>
          {memberName}在所有业务表上都跟随员工默认权限。
        </p>
      ) : (
        <ul className={styles.accessRows}>
          {visible.map((row) => (
            <li key={row.objectId}>
              <ObjectAccessRow
                row={row}
                tenantCode={tenantCode}
                memberName={memberName}
                isGroupLeader={isGroupLeader}
                saving={save.isPending}
                feedback={
                  feedback?.objectId === row.objectId ? feedback : undefined
                }
                onDismissFeedback={() => setFeedback(undefined)}
                onSave={(input) =>
                  save.mutate({ objectId: row.objectId, input })
                }
                columnEditor={
                  <BulkMemberAccess
                    tenantCode={tenantCode}
                    selected={[
                      {
                        id: memberId,
                        displayName: memberName,
                        role: "EMPLOYEE",
                        status: "ACTIVE",
                      },
                    ]}
                    initialRows={rows}
                    initialObjectId={row.objectId}
                    disabled={save.isPending}
                    buttonLabel="设置列权限"
                    onChanged={async () => {
                      setFeedback({
                        objectId: row.objectId,
                        tone: "success",
                        text: `${row.objectName}的列权限已保存，立即生效`,
                      });
                      try {
                        setRows(await api.list(tenantCode, memberId));
                      } catch (caught) {
                        setFeedback({
                          objectId: row.objectId,
                          tone: "error",
                          text: `权限已保存，刷新失败：${toApiError(caught).message}`,
                        });
                      }
                      void queryClient.invalidateQueries({
                        queryKey: ["workspace", tenantCode, "members"],
                      });
                    }}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Feedback {
  objectId: string;
  tone: "success" | "error";
  text: string;
}

function ObjectAccessRow({
  row,
  tenantCode,
  memberName,
  isGroupLeader,
  saving,
  feedback,
  columnEditor,
  onSave,
  onDismissFeedback,
}: {
  row: MemberObjectAccessRow;
  tenantCode: string;
  memberName: string;
  isGroupLeader: boolean;
  saving: boolean;
  feedback?: Feedback;
  columnEditor: React.ReactNode;
  onSave: (input: MemberObjectAccessInput) => void;
  onDismissFeedback: () => void;
}) {
  const bodyId = useId();
  const exception = row.mode === "OVERRIDE";
  const columns = fieldExceptions(row);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const groupEnabled = isGroupLeader && row.effective.readScope === "GROUP";
  const [groupEditing, setGroupEditing] = useState(false);
  const [groupDraft, setGroupDraft] = useState(() => groupFieldDraft(row));
  const [draft, setDraft] = useState<MemberObjectPolicy>(
    () => row.override ?? row.effective,
  );
  // A saved row from the server replaces local state: the editor closes and
  // the next edit starts from what is now stored. A failed save keeps both.
  const [savedRow, setSavedRow] = useState(row);
  if (savedRow !== row) {
    setSavedRow(row);
    setEditing(false);
    setGroupEditing(false);
    setGroupDraft(groupFieldDraft(row));
    setDraft(row.override ?? row.effective);
  }

  return (
    <section
      role="group"
      aria-label={row.objectName}
      className={styles.accessRow}
      data-exception={exception || columns > 0 || undefined}
    >
      <div className={styles.accessRowHead}>
        <button
          type="button"
          className={styles.accessToggle}
          aria-expanded={open || editing}
          aria-controls={bodyId}
          onClick={() => setOpen(!(open || editing))}
        >
          <DownOutlined aria-hidden className={styles.accessChevron} />
          <span className={styles.accessName}>
            <strong>{row.objectName}</strong>
            <span className={styles.accessCode}>{row.objectCode}</span>
          </span>
        </button>
        <span className={styles.accessTags}>
          <StatusTag tone={exception ? "warning" : "neutral"}>
            {exception ? "成员例外" : "跟随员工默认"}
          </StatusTag>
          {columns > 0 ? (
            <StatusTag tone="warning">{columns} 列例外</StatusTag>
          ) : null}
        </span>
        <PolicySummary policy={row.effective} />
      </div>
      {feedback && !groupEditing ? (
        <Alert
          className={styles.accessFeedback}
          type={feedback.tone}
          showIcon
          closable
          title={feedback.text}
          onClose={onDismissFeedback}
        />
      ) : null}
      {row.override?.readScope === "GROUP" && !isGroupLeader ? (
        <Alert
          className={styles.accessFeedback}
          type="warning"
          showIcon
          title="已不再是有效组长，本组查看授权暂不生效，回退为仅本人负责"
          description="修改例外时，请改选其他查看范围后保存，或恢复为员工默认。"
        />
      ) : null}

      {open || editing ? (
        <div id={bodyId} className={styles.accessBody}>
          <div className={styles.accessBlock}>
            {editing ? (
              <PolicyEditor
                objectId={row.objectId}
                draft={draft}
                saving={saving}
                isGroupLeader={isGroupLeader}
                onChange={setDraft}
              />
            ) : (
              <PolicyComparison row={row} />
            )}
            <div className={styles.accessActions}>
              {editing ? (
                <>
                  <Button
                    type="primary"
                    loading={saving}
                    disabled={
                      saving || (draft.readScope === "GROUP" && !isGroupLeader)
                    }
                    onClick={() =>
                      onSave({
                        mode: "OVERRIDE",
                        canCreate: draft.canCreate,
                        canRead: draft.canRead,
                        canUpdate: draft.canUpdate,
                        readScope: draft.readScope,
                        updateScope: draft.updateScope,
                      })
                    }
                  >
                    保存例外
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      setDraft(row.override ?? row.effective);
                    }}
                  >
                    取消
                  </Button>
                  <span className={styles.accessHint}>
                    例外会整条替换{memberName}
                    在这张表上的员工默认，保存后立即生效。
                  </span>
                </>
              ) : (
                <>
                  <Button
                    disabled={saving || groupEditing}
                    onClick={() => setEditing(true)}
                  >
                    {exception ? "修改表例外" : "设置表例外"}
                  </Button>
                  {exception ? (
                    <Button
                      disabled={saving}
                      onClick={() => setRestoring(true)}
                    >
                      恢复为员工默认
                    </Button>
                  ) : null}
                  <Link
                    className={styles.accessDesigner}
                    href={`/workspace/${tenantCode}/settings/objects/${row.objectId}`}
                  >
                    查看员工默认设置
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className={styles.accessBlock}>
            {(row.fields ?? []).length ? (
              <FieldComparison row={row} groupEnabled={groupEnabled} />
            ) : null}
            <div className={styles.accessActions}>{columnEditor}</div>
            {groupEnabled ? (
              <>
                {!row.effective.canUpdate ? (
                  <Alert
                    type="info"
                    showIcon
                    title="可以修改记录已关闭，组员记录中的可编辑列实际只读"
                  />
                ) : null}
                <p className={styles.accessHint}>
                  原记录操作范围仍为
                  {DATA_SCOPE_LABELS[row.effective.updateScope]}
                  ，组员列授权仅用于普通字段修改，不授予负责人变更、跟进或附件操作。
                  涉及额外记录操作的自动化仍需对应权限，命中无权执行的规则时本次修改整体失败。
                </p>
                <Modal
                  open={groupEditing}
                  title={`${row.objectName} · 组员列权限`}
                  width={OVERLAY_SIZE.form}
                  footer={null}
                  closable={!saving}
                  mask={{ closable: !saving }}
                  keyboard={!saving}
                  onCancel={() => {
                    setGroupEditing(false);
                    setGroupDraft(groupFieldDraft(row));
                  }}
                  destroyOnHidden
                >
                  {feedback?.tone === "error" ? (
                    <Alert type="error" showIcon title={feedback.text} />
                  ) : null}
                  <fieldset className={styles.policyEditor} disabled={saving}>
                    <legend>本组其他成员记录 · 保存后立即生效</legend>
                    <p className={styles.accessHint}>
                      隐藏标题列后无法查看对应组员记录，系统列不能设为可编辑。
                    </p>
                    {row.fields.map((field) => (
                      <div key={field.fieldId} className={styles.policyField}>
                        <label
                          htmlFor={`${row.objectId}-group-${field.fieldKey}`}
                        >
                          {field.label}
                        </label>
                        <Select
                          id={`${row.objectId}-group-${field.fieldKey}`}
                          aria-label={`组员列权限 ${field.label}`}
                          value={groupDraft[field.fieldKey]}
                          disabled={saving}
                          onChange={(access: PublishedFieldAccess) =>
                            setGroupDraft((current) => ({
                              ...current,
                              [field.fieldKey]: access,
                            }))
                          }
                          options={(
                            ["EDIT", "READ_ONLY", "HIDDEN"] as const
                          ).map((access) => ({
                            value: access,
                            label: FIELD_ACCESS_LABELS[access],
                            disabled: field.isSystem && access === "EDIT",
                          }))}
                        />
                        {field.fieldKey === row.titleFieldKey &&
                        groupDraft[field.fieldKey] === "HIDDEN" ? (
                          <span className={styles.fieldNote}>
                            隐藏标题列后将无法查看对应组员记录
                          </span>
                        ) : null}
                      </div>
                    ))}
                    <div className={styles.accessActions}>
                      <Button
                        type="primary"
                        loading={saving}
                        disabled={saving}
                        onClick={() =>
                          onSave(groupPolicyInput(row, groupDraft))
                        }
                      >
                        保存组员列权限
                      </Button>
                      <Button
                        aria-label="取消组员列权限"
                        disabled={saving}
                        onClick={() => {
                          setGroupEditing(false);
                          setGroupDraft(groupFieldDraft(row));
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </fieldset>
                </Modal>
                <div className={styles.accessActions}>
                  <Button
                    disabled={saving || editing || groupEditing}
                    onClick={() => setGroupEditing(true)}
                  >
                    设置组员列权限
                  </Button>
                  {row.effective.groupFieldAccess ? (
                    <Button
                      disabled={saving || editing || groupEditing}
                      onClick={() => onSave(groupPolicyInput(row, null))}
                    >
                      恢复原有组员列规则
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <Modal
        open={restoring}
        title={`恢复${row.objectName}为员工默认？`}
        okText="恢复为员工默认"
        cancelText="取消"
        width={OVERLAY_SIZE.confirm}
        onCancel={() => setRestoring(false)}
        onOk={() => {
          setRestoring(false);
          onSave({ mode: "INHERIT" });
        }}
      >
        <p>
          将删除{memberName}在这张表上的成员例外，立即改为员工默认：
          {describePolicy(row.inherited)}。列的例外不受影响。
        </p>
      </Modal>
    </section>
  );
}

/** What the member can do now: one short phrase per action. */
function PolicySummary({ policy }: { policy: MemberObjectPolicy }) {
  return (
    <dl className={styles.policySummary} aria-label="当前生效">
      {POLICY_ROWS.map(([label, describe]) => (
        <div key={label}>
          <dt>
            {label === "修改" && policy.readScope === "GROUP"
              ? "原记录操作"
              : label}
          </dt>
          <dd data-denied={describe(policy).denied || undefined}>
            {describe(policy).text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const POLICY_ROWS: Array<
  [string, (policy: MemberObjectPolicy) => { text: string; denied: boolean }]
> = [
  [
    "新建",
    (policy) => ({
      text: policy.canCreate ? "可以" : "不可以",
      denied: !policy.canCreate,
    }),
  ],
  [
    "查看",
    (policy) =>
      policy.canRead && policy.readScope !== "NONE"
        ? { text: MEMBER_READ_SCOPE_LABELS[policy.readScope], denied: false }
        : { text: "不可以", denied: true },
  ],
  [
    "修改",
    (policy) =>
      policy.canUpdate && policy.updateScope !== "NONE"
        ? { text: DATA_SCOPE_LABELS[policy.updateScope], denied: false }
        : { text: "不可以", denied: true },
  ],
];

function PolicyComparison({ row }: { row: MemberObjectAccessRow }) {
  return (
    <table className={styles.compareTable} aria-label="表权限对照">
      <thead>
        <tr>
          <th scope="col">表权限</th>
          <th scope="col">员工默认</th>
          <th scope="col">
            {row.mode === "OVERRIDE" ? "成员例外（生效）" : "当前生效"}
          </th>
        </tr>
      </thead>
      <tbody>
        {POLICY_ROWS.map(([label, describe]) => {
          const inherited = describe(row.inherited).text;
          const effective = describe(row.effective).text;
          return (
            <tr key={label} data-changed={inherited !== effective || undefined}>
              <th scope="row">{label}</th>
              <td>{inherited}</td>
              <td>{effective}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FieldComparison({
  row,
  groupEnabled,
}: {
  row: MemberObjectAccessRow;
  groupEnabled: boolean;
}) {
  return (
    <table className={styles.compareTable} aria-label="列权限对照">
      <thead>
        <tr>
          <th scope="col">列</th>
          <th scope="col">员工默认</th>
          <th scope="col">{groupEnabled ? "本人记录" : "当前生效"}</th>
          {groupEnabled ? <th scope="col">本组其他成员记录</th> : null}
        </tr>
      </thead>
      <tbody>
        {row.fields.map((field: Field) => (
          <tr
            key={field.fieldId}
            data-changed={(!field.isSystem && field.override) || undefined}
          >
            <th scope="row">
              {field.label}
              {field.isSystem ? (
                <span className={styles.fieldNote}>系统列，不可设置例外</span>
              ) : field.override ? (
                <span className={styles.fieldNote}>成员例外</span>
              ) : null}
            </th>
            <td>{FIELD_ACCESS_LABELS[field.inherited]}</td>
            <td>{FIELD_ACCESS_LABELS[field.effective]}</td>
            {groupEnabled ? (
              <td>{FIELD_ACCESS_LABELS[groupEffective(row, field)]}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PolicyEditor({
  objectId,
  draft,
  saving,
  isGroupLeader,
  onChange,
}: {
  objectId: string;
  draft: MemberObjectPolicy;
  saving: boolean;
  isGroupLeader: boolean;
  onChange: (draft: MemberObjectPolicy) => void;
}) {
  const switches = [
    ["canCreate", "可以新建记录"],
    ["canRead", "可以查看记录"],
    ["canUpdate", "可以修改记录"],
  ] as const;
  const scopes = [
    ["readScope", "查看范围"],
    ["updateScope", "修改范围"],
  ] as const;
  return (
    <fieldset className={styles.policyEditor} disabled={saving}>
      <legend>成员例外 · 保存后立即生效</legend>
      {switches.map(([key, label]) => (
        <label key={key} className={styles.policyField}>
          <span>{label}</span>
          <Switch
            aria-label={label}
            checked={draft[key]}
            disabled={saving}
            onChange={(checked) => onChange({ ...draft, [key]: checked })}
          />
        </label>
      ))}
      {scopes.map(([key, label]) => (
        <div key={key} className={styles.policyField}>
          <label htmlFor={`${objectId}-${key}`}>
            {key === "updateScope" && draft.readScope === "GROUP"
              ? "原记录操作范围"
              : label}
          </label>
          <Select
            id={`${objectId}-${key}`}
            aria-label={label}
            value={draft[key]}
            disabled={saving}
            onChange={(value) => onChange({ ...draft, [key]: value })}
            options={(
              [
                "ALL",
                "OWN",
                ...(key === "readScope" &&
                (isGroupLeader || draft.readScope === "GROUP")
                  ? ["GROUP" as const]
                  : []),
                "NONE",
              ] as const
            ).map((scope) => ({
              value: scope,
              label: MEMBER_READ_SCOPE_LABELS[scope],
              disabled: scope === "GROUP" && !isGroupLeader,
            }))}
          />
        </div>
      ))}
    </fieldset>
  );
}

/** 「可以新建，查看全部记录，修改仅本人负责」 */
function describePolicy(policy: MemberObjectPolicy): string {
  const [, read, update] = POLICY_ROWS.map(([, describe]) => describe(policy));
  return [
    policy.canCreate ? "可以新建" : "不能新建",
    read.denied ? "不能查看" : `查看${read.text}`,
    update.denied ? "不能修改" : `修改${update.text}`,
  ].join("，");
}

function groupEffective(
  row: MemberObjectAccessRow,
  field: Field,
): PublishedFieldAccess {
  if (field.groupEffective) return field.groupEffective;
  if (!row.effective.canRead || field.effective === "HIDDEN") return "HIDDEN";
  return row.effective.canUpdate && row.effective.updateScope === "ALL"
    ? field.effective
    : "READ_ONLY";
}

function groupFieldDraft(
  row: MemberObjectAccessRow,
): Record<string, PublishedFieldAccess> {
  const configured = row.effective.groupFieldAccess;
  return Object.fromEntries(
    (row.fields ?? []).map((field) => [
      field.fieldKey,
      (configured && Object.hasOwn(configured, field.fieldKey)
        ? configured[field.fieldKey]
        : undefined) ??
        (groupEffective(row, field) === "HIDDEN" ? "HIDDEN" : "READ_ONLY"),
    ]),
  );
}

function groupPolicyInput(
  row: MemberObjectAccessRow,
  groupFieldAccess: Record<string, PublishedFieldAccess> | null,
): MemberObjectAccessInput {
  const { canCreate, canRead, canUpdate, readScope, updateScope } =
    row.effective;
  return {
    mode: "OVERRIDE",
    canCreate,
    canRead,
    canUpdate,
    readScope,
    updateScope,
    groupFieldAccess,
  };
}
