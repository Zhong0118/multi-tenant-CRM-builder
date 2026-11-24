"use client";
import { Button, InputNumber, Radio, Select, Skeleton } from "antd";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page, PageSection } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/components/feedback/use-toast";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { briefApi, type BriefRules } from "./brief-api";
import styles from "./brief.module.css";
export function BriefSettings({
  tenantCode,
  memberId,
}: {
  tenantCode: string;
  memberId: string;
}) {
  const client = useQueryClient(),
    toast = useToast(),
    key = ["daily-brief-settings", tenantCode, memberId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => briefApi.rules(tenantCode),
  });
  const [draft, setDraft] = useState<BriefRules>();
  const save = useMutation({
    mutationFn: (v: BriefRules) => briefApi.save(tenantCode, v),
    onSuccess: (saved) => {
      client.setQueryData(key, { ...query.data, ...saved });
      setDraft(undefined);
      void client.invalidateQueries({
        queryKey: ["workspace", tenantCode, "follow-ups"],
      });
      void client.invalidateQueries({
        queryKey: ["daily-brief-suggestions", tenantCode],
      });
      toast.success("需要关注规则已保存");
    },
  });
  const r = draft ?? query.data;
  const change = (v: Partial<BriefRules>) => {
    if (r)
      setDraft({
        version: r.version,
        objectIds: r.objectIds,
        contactDays: r.contactDays,
        stagnantDays: r.stagnantDays,
        reclaimDays: r.reclaimDays,
        ...v,
      });
  };
  return (
    <Page width="settings">
      <PageHeader
        title="需要关注"
        description="决定员工工作台「需要关注」里列出哪些记录"
      />
      {query.isError ? (
        <LoadError error={query.error} retry={() => void query.refetch()} />
      ) : !r || !query.data ? (
        <Skeleton active />
      ) : (
        <PageSection title="规则清单">
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (draft) save.mutate(draft);
            }}
          >
            <div className={styles.field}>
              <span id="brief-objects-label">纳入的业务表</span>
              <Radio.Group
                aria-labelledby="brief-objects-label"
                value={r.objectIds === null ? "all" : "selected"}
                onChange={(e) =>
                  change({ objectIds: e.target.value === "all" ? null : [] })
                }
                options={[
                  { label: "全部有负责人的已发布表", value: "all" },
                  { label: "指定业务表", value: "selected" },
                ]}
              />
            </div>
            {r.objectIds !== null && (
              <Select
                aria-label="选择业务表"
                mode="multiple"
                value={r.objectIds}
                options={query.data.objects.map((o) => ({
                  value: o.id,
                  label: o.name,
                }))}
                onChange={(ids) => change({ objectIds: ids })}
              />
            )}
            {(
              [
                ["contactDays", "多久没联系需要提醒"],
                ["stagnantDays", "停留多久算停滞"],
                ["reclaimDays", "提前提醒收回"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={styles.field}>
                {label}
                <InputNumber
                  aria-label={label}
                  min={1}
                  max={365}
                  precision={0}
                  value={r[k]}
                  onChange={(v) => change({ [k]: v ?? 0 })}
                  suffix="天"
                />
              </label>
            ))}
            {save.isError && (
              <LoadError
                error={save.error}
                retry={() => {
                  if ((save.error as { status?: number }).status === 409) {
                    setDraft(undefined);
                    save.reset();
                    void query.refetch();
                  } else if (draft) save.mutate(draft);
                }}
              />
            )}
            <div>
              <Button
                type="primary"
                htmlType="submit"
                loading={save.isPending}
                disabled={
                  !draft ||
                  [r.contactDays, r.stagnantDays, r.reclaimDays].some(
                    (v) => v < 1 || v > 365,
                  )
                }
              >
                保存
              </Button>
            </div>
          </form>
        </PageSection>
      )}
    </Page>
  );
}
