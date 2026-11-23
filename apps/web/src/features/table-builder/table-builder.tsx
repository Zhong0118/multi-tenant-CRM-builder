"use client";

import type {
  TableBlueprint,
  TableBuilderAnswer,
  TableBuilderIssue,
  TableBuilderResult,
  TablePlan,
} from "@crm/contracts";
import {
  DeleteOutlined,
  TableOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Modal } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PreviewChoices } from "@/components/forms/preview-choices";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import type { ObjectDraft } from "@/features/objects/object-types";
import {
  builderApi,
  builderError,
  type BuilderApi,
  type DraftResult,
} from "./builder-api";
import { DraftGroup } from "./draft-group";
import { TableDiff } from "./table-diff";
import { Issues, TableEditor } from "./table-editor";
import styles from "./table-builder.module.css";

type Question = Extract<TableBuilderResult, { kind: "question" }>;
export function TableBuilder({
  tenantCode,
  draft,
  api = builderApi,
}: {
  tenantCode: string;
  draft?: ObjectDraft;
  api?: BuilderApi;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  function refreshObjects() {
    void queryClient.invalidateQueries({
      queryKey: ["workspace", tenantCode, "object-definitions"],
    });
    router.refresh();
  }
  const base = `/workspace/${tenantCode}/settings/objects`;
  const target = draft
    ? { objectId: draft.object.id, expectedVersion: draft.object.version }
    : undefined;
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<TableBuilderAnswer[]>([]);
  const [question, setQuestion] = useState<Question>();
  const [other, setOther] = useState<string>();
  const [blueprint, setBlueprint] = useState<TableBlueprint>();
  const [issues, setIssues] = useState<TableBuilderIssue[]>([]);
  const [selected, setSelected] = useState("");
  const table =
    blueprint?.tables.find((t) => t.id === selected) ?? blueprint?.tables[0];
  const [instruction, setInstruction] = useState("");
  const [candidate, setCandidate] = useState<{
    table: TablePlan;
    omitted: TableBlueprint["omitted"];
    assumptions: string[];
    issues: TableBuilderIssue[];
  }>();
  const [result, setResult] = useState<DraftResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const request = useRef(0);
  const working = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = !result && Boolean(description.trim() || blueprint);
  useEffect(() => {
    if (!dirty) return;
    function leave(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    function navigate(e: MouseEvent) {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const link =
        e.target instanceof Element
          ? e.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        link.target === "_blank" ||
        link.href === window.location.href
      )
        return;
      if (!window.confirm("离开后将丢弃本页未确认的方案。继续离开？")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current++;
    },
    [],
  );
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(builderError(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function generate(nextAnswers: TableBuilderAnswer[]) {
    void run(async () => {
      const next = await api.preview(tenantCode, {
        description,
        answers: nextAnswers,
        target,
      });
      setAnswers(nextAnswers);
      setOther(undefined);
      if (next.kind === "question") {
        setQuestion(next);
        return;
      }
      setBlueprint(next.blueprint);
      setIssues(next.issues);
      setQuestion(undefined);
      setSelected(next.blueprint.tables[0]?.id ?? "");
      setCandidate(undefined);
      setNeedsCheck(false);
      setInstruction("");
    });
  }
  function answer(choiceId: string, otherText?: string) {
    if (question)
      generate([
        ...answers,
        { key: question.key, choiceId, ...(otherText ? { otherText } : {}) },
      ]);
  }
  function edit(value: TableBlueprint) {
    const sequence = ++request.current;
    clearTimeout(timer.current);
    setBlueprint(value);
    setNeedsCheck(true);
    setChecking(true);
    setCandidate(undefined);
    setError("");
    timer.current = setTimeout(async () => {
      try {
        const next = await api.validate(tenantCode, {
          blueprint: value,
          target,
        });
        if (request.current !== sequence) return;
        setBlueprint(next.blueprint);
        setIssues(next.issues);
        setNeedsCheck(false);
      } catch (e) {
        if (request.current === sequence) setError(builderError(e));
      } finally {
        if (request.current === sequence) setChecking(false);
      }
    }, 220);
  }
  function updateTable(next: TablePlan) {
    if (blueprint)
      edit({
        ...blueprint,
        tables: blueprint.tables.map((t) => (t.id === next.id ? next : t)),
      });
  }
  const blocked =
    busy ||
    needsCheck ||
    issues.some((i) => i.blocking) ||
    !!candidate ||
    !!question ||
    !blueprint?.tables.length;
  const manual = draft ? base + "/" + draft.object.id : base + "/new";
  return (
    <Page width="editor">
      <div className={styles.builder}>
        <PageHeader
          title={draft ? "用 AI 补充字段" : "AI 建表"}
          breadcrumb={<Link href={base}>业务表</Link>}
          description={
            draft
              ? `为「${draft.object.name}」建议新字段，确认后写入草稿。`
              : "描述业务，核对表和字段，再将选中的方案保存为草稿。"
          }
          extra={
            !result && (
              <Link href={manual}>{draft ? "返回设计器" : "手动建表"}</Link>
            )
          }
        />
        {result ? (
          <DraftGroup
            tenantCode={tenantCode}
            result={result}
            api={api}
            names={new Map(blueprint?.tables.map((t) => [t.code, t.name]))}
            onPublished={refreshObjects}
          />
        ) : (
          <>
            <fieldset disabled={busy} className={styles.canvas}>
              <section className={styles.composer}>
                <label htmlFor="builder-description">业务描述</label>
                <textarea
                  id="builder-description"
                  rows={blueprint ? 2 : 4}
                  value={description}
                  placeholder={
                    draft
                      ? "例如：增加客户的来源渠道、预算和技术顾问"
                      : "例如：我们做设备租赁，需要管理客户、合同、设备和回款。销售只能看自己负责的客户。"
                  }
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setQuestion(undefined);
                    setAnswers([]);
                    setOther(undefined);
                  }}
                />
                {!blueprint && !question && (
                  <div className={styles.actions}>
                    <Button
                      type="primary"
                      loading={busy}
                      disabled={!description.trim()}
                      icon={<ThunderboltOutlined />}
                      onClick={() => generate(answers)}
                    >
                      生成预览
                    </Button>
                  </div>
                )}
                {question && (
                  <div>
                    <PreviewChoices
                      prompt={question.prompt}
                      options={question.options.map((o) => ({
                        ...o,
                        value: o.id,
                      }))}
                      onSelect={(id) =>
                        id === "other" ? setOther("") : answer(id)
                      }
                    />
                    {other !== undefined && (
                      <div className={styles.row}>
                        <label>
                          其他回答
                          <input
                            value={other}
                            maxLength={200}
                            onChange={(e) => setOther(e.target.value)}
                          />
                        </label>
                        <Button
                          disabled={!other.trim()}
                          onClick={() => answer("other", other.trim())}
                        >
                          继续生成
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </section>
              {error && (
                <Alert
                  type="error"
                  showIcon
                  title={error}
                  action={
                    needsCheck && blueprint && !checking ? (
                      <Button onClick={() => edit(blueprint)}>重新校验</Button>
                    ) : undefined
                  }
                />
              )}
              {blueprint && (
                <>
                  <div className={styles.grid}>
                    <nav aria-label="方案中的业务表" className={styles.side}>
                      <h2>
                        {draft ? "目标业务表" : "方案中的表"}{" "}
                        <span>{blueprint.tables.length}</span>
                      </h2>
                      {blueprint.tables.map((t) => (
                        <div
                          className={styles.tab}
                          key={t.id}
                          data-active={table?.id === t.id}
                        >
                          <button
                            type="button"
                            aria-current={
                              table?.id === t.id ? "true" : undefined
                            }
                            onClick={() => {
                              setSelected(t.id);
                              setCandidate(undefined);
                              setInstruction("");
                            }}
                          >
                            <TableOutlined aria-hidden />
                            <span>
                              <strong>{t.name || "未命名表"}</strong>
                              <small>
                                {t.fields.length} 个字段 ·{" "}
                                {
                                  issues.filter((i) => i.tableId === t.id)
                                    .length
                                }{" "}
                                项提示
                              </small>
                            </span>
                          </button>
                          {!draft && (
                            <Button
                              type="text"
                              aria-label={`移除表 ${t.name}`}
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                edit({
                                  ...blueprint,
                                  tables: blueprint.tables.filter(
                                    (x) => x.id !== t.id,
                                  ),
                                })
                              }
                            />
                          )}
                        </div>
                      ))}
                    </nav>
                    <div className={styles.detail} key={table?.id}>
                      {table && (
                        <>
                          <TableEditor
                            table={table}
                            target={draft}
                            issues={issues.filter(
                              (i) => i.tableId === table.id,
                            )}
                            onChange={updateTable}
                          />
                          <section className={styles.section}>
                            <h2>调整这张表</h2>
                            <label>
                              调整说明
                              <textarea
                                rows={2}
                                value={instruction}
                                onChange={(e) => setInstruction(e.target.value)}
                              />
                            </label>
                            <Button
                              disabled={
                                !instruction.trim() || needsCheck || !!candidate
                              }
                              onClick={() =>
                                void run(async () => {
                                  const next = await api.refine(tenantCode, {
                                    blueprint,
                                    tableId: table.id,
                                    description: instruction,
                                    target,
                                  });
                                  const proposed = next.blueprint.tables.find(
                                    (t) => t.id === table.id,
                                  );
                                  if (!proposed)
                                    throw new Error("未返回选中表的调整方案");
                                  setCandidate({
                                    table: proposed,
                                    omitted: next.blueprint.omitted,
                                    assumptions: next.blueprint.assumptions,
                                    issues: next.issues.filter(
                                      (i) =>
                                        !i.tableId || i.tableId === table.id,
                                    ),
                                  });
                                })
                              }
                            >
                              按说明调整
                            </Button>
                            {candidate && (
                              <>
                                <TableDiff
                                  before={table}
                                  after={candidate.table}
                                />
                                <Issues items={candidate.issues} />
                                {candidate.omitted
                                  .filter(
                                    (o) =>
                                      !blueprint.omitted.some(
                                        (old) =>
                                          old.request === o.request &&
                                          old.reason === o.reason,
                                      ),
                                  )
                                  .map((o, n) => (
                                    <p key={n}>
                                      未采纳 · {o.request} · {o.reason}{" "}
                                      {o.alternative}
                                    </p>
                                  ))}
                                <div className={styles.actions}>
                                  <Button
                                    onClick={() => setCandidate(undefined)}
                                  >
                                    放弃调整
                                  </Button>
                                  <Button
                                    type="primary"
                                    onClick={() => {
                                      edit({
                                        ...blueprint,
                                        omitted: candidate.omitted,
                                        assumptions: candidate.assumptions,
                                        tables: blueprint.tables.map((t) =>
                                          t.id === candidate.table.id
                                            ? candidate.table
                                            : t,
                                        ),
                                      });
                                      setInstruction("");
                                    }}
                                  >
                                    采用调整
                                  </Button>
                                </div>
                              </>
                            )}
                          </section>
                        </>
                      )}
                    </div>
                  </div>
                  <Issues
                    items={issues.filter(
                      (i) =>
                        !i.tableId ||
                        !blueprint.tables.some((t) => t.id === i.tableId),
                    )}
                  />
                  {blueprint.assumptions.length > 0 && (
                    <details className={styles.section}>
                      <summary>
                        方案假设（{blueprint.assumptions.length}）
                      </summary>
                      <ul>
                        {blueprint.assumptions.map((a, n) => (
                          <li key={n}>{a}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <footer className={styles.footer}>
                    <details>
                      <summary>
                        已内置／未采纳（{blueprint.omitted.length}）
                      </summary>
                      {blueprint.omitted.length ? (
                        <ul>
                          {blueprint.omitted.map((o, n) => (
                            <li key={n}>
                              <strong>{o.request}</strong> · {o.reason}
                              {o.alternative && <p>{o.alternative}</p>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>没有未采纳项</p>
                      )}
                    </details>
                    <div className={styles.row}>
                      <span role="status">
                        {checking
                          ? "正在校验…"
                          : needsCheck
                            ? "等待重新校验"
                            : issues.some((i) => i.blocking)
                              ? "请先修正阻塞项"
                              : ""}
                      </span>
                      <Button
                        disabled={!description.trim() || checking}
                        onClick={() => setRegenerate(true)}
                      >
                        整组重新生成
                      </Button>
                      <Button
                        type="primary"
                        disabled={blocked}
                        onClick={() => {
                          if (!blocked)
                            void run(async () => {
                              setResult(
                                await api.confirm(tenantCode, {
                                  blueprint,
                                  target,
                                }),
                              );
                              refreshObjects();
                            });
                        }}
                      >
                        {draft
                          ? `确认追加 ${table?.fields.length ?? 0} 个字段`
                          : `确认创建 ${blueprint.tables.length} 张草稿`}
                      </Button>
                    </div>
                  </footer>
                </>
              )}
            </fieldset>
            <Modal
              title="重新生成整个方案？"
              open={regenerate}
              onCancel={() => setRegenerate(false)}
              okText="重新生成"
              cancelText="保留方案"
              onOk={() => {
                setRegenerate(false);
                generate(answers);
              }}
            >
              生成成功后将替换当前表和字段，包括手动调整的内容。
            </Modal>
          </>
        )}
      </div>
    </Page>
  );
}
