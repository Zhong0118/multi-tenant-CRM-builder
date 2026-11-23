"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button, Alert } from "antd";
import {
  builderError,
  type BuilderApi,
  type DraftResult,
  type GroupAnalysis,
} from "./builder-api";
import styles from "./table-builder.module.css";

export function DraftGroup({
  tenantCode,
  result,
  names,
  api,
  onPublished,
}: {
  tenantCode: string;
  result: DraftResult;
  names: Map<string, string>;
  api: BuilderApi;
  onPublished: () => void;
}) {
  const [analysis, setAnalysis] = useState<GroupAnalysis>();
  const [error, setError] = useState("");
  const [published, setPublished] = useState<number>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setAnalysis(undefined);
      setError(builderError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function analyze() {
    void run(async () =>
      setAnalysis(
        await api.analyze(tenantCode, {
          objectIds: result.objects.map((o) => o.id),
        }),
      ),
    );
  }
  const blocked =
    analysis &&
    (analysis.blocking.length > 0 ||
      analysis.objects.some((o) => o.analysis.blocking.length));
  return (
    <section className={styles.section}>
      <h2>
        {published !== undefined
          ? `已发布 ${published} 张业务表`
          : analysis
            ? "整组发布分析"
            : "草稿已保存"}
      </h2>
      <p>
        {published !== undefined
          ? "员工可按已发布的权限使用业务表。"
          : "可打开员工权限编辑器配置授权，保存后返回此页重新分析。"}
      </p>
      <ul className={styles.objects}>
        {result.objects.map((item) => {
          const row = analysis?.objects.find((o) => o.id === item.id);
          return (
            <li key={item.id}>
              <div>
                <strong>
                  {row?.name ?? names.get(item.code) ?? item.code}
                </strong>{" "}
                <code>{item.code}</code>
                {row && (
                  <small>
                    草稿 v{row.version} → 预计发布 v{row.nextPublicationNumber}{" "}
                    · {row.analysis.changes.length} 项变更
                  </small>
                )}
                {row?.analysis.blocking.map((i, n) => (
                  <p className={styles.issue} key={n}>
                    {i.message}
                  </p>
                ))}
                {row?.analysis.warnings.map((i, n) => (
                  <p key={n}>{i.message}</p>
                ))}
              </div>
              <a
                target="_blank"
                rel="noreferrer"
                href={`/workspace/${tenantCode}/settings/objects/${item.id}?section=permissions`}
              >
                配置员工权限<span className={styles.sr}>（新窗口）</span>
              </a>
            </li>
          );
        })}
      </ul>
      {analysis?.blocking
        .filter(
          (issue) =>
            !analysis.objects
              .find((o) => o.id === issue.objectId)
              ?.analysis.blocking.some((i) => i.message === issue.message),
        )
        .map((issue, n) => (
          <p key={n} className={styles.issue}>
            {issue.message}
          </p>
        ))}
      {error && <Alert type="error" showIcon title={error} />}
      <div className={styles.actions}>
        <Link href={`/workspace/${tenantCode}/settings/objects`}>
          返回业务表
        </Link>
        {published === undefined && (
          <>
            <Button disabled={busy} onClick={analyze}>
              {analysis || error ? "重新分析" : "检查整组发布"}
            </Button>
            {analysis && (
              <Button
                type="primary"
                disabled={busy || Boolean(blocked)}
                onClick={() =>
                  void run(async () => {
                    const value = await api.publish(tenantCode, {
                      objects: analysis.objects.map((o) => ({
                        id: o.id,
                        expectedVersion: o.version,
                        expectedPoolConfigVersion: o.poolConfigVersion,
                      })),
                    });
                    setPublished(value.published.length);
                    onPublished();
                  })
                }
              >
                确认发布 {result.objects.length} 张表
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
