"use client";

import { NodeIndexOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal } from "antd";
import { useState } from "react";

import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { toApiError, type ApiError } from "@/lib/api/api-error";
import {
  templateInitializationApi,
  type TemplateInitializationApi,
  type TemplateInitializationGroups,
} from "./template-initialization-api";
import styles from "./template-initialization.module.css";

type Group = TemplateInitializationGroups["groups"][number];
interface Props {
  tenantCode: string;
  onPublished: () => void;
  api?: TemplateInitializationApi;
}

export function TemplateInitialization({
  tenantCode,
  onPublished,
  api = templateInitializationApi,
}: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["workspace", tenantCode, "template-initialization"];
  const groups = useQuery({ queryKey, queryFn: () => api.list(tenantCode) });
  const [selected, setSelected] = useState<Group>();
  const [error, setError] = useState<ApiError>();
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [notice, setNotice] = useState<string>();
  const publish = useMutation({
    mutationFn: (group: Group) =>
      api.publish(tenantCode, {
        templateVersionId: group.templateVersionId,
        objects: group.objects.map((object) => ({
          id: object.id,
          expectedVersion: object.version,
          expectedPoolConfigVersion: object.poolConfigVersion,
        })),
      }),
    onSuccess: (result, group) => {
      setSelected(undefined);
      setNotice(
        `已发布 ${result.published.length} 张业务表，员工可按配置的权限使用`,
      );
      queryClient.setQueryData<TemplateInitializationGroups>(
        queryKey,
        (current) =>
          current
            ? {
                groups: current.groups.filter(
                  (item) => item.templateVersionId !== group.templateVersionId,
                ),
              }
            : current,
      );
      void queryClient.invalidateQueries({ queryKey });
      onPublished();
    },
    onError: (caught) => {
      setError(toApiError(caught));
      setRefreshRequired(true);
    },
  });

  return (
    <>
      {notice ? (
        <Alert
          showIcon
          closable
          type="success"
          title={notice}
          onClose={() => setNotice(undefined)}
        />
      ) : null}
      {groups.isError ? (
        <Alert
          type="warning"
          showIcon
          title="初始化流程暂时无法读取"
          description={toApiError(groups.error).message}
          action={
            <Button
              loading={groups.isFetching}
              onClick={() => void groups.refetch()}
            >
              重试
            </Button>
          }
        />
      ) : null}
      {groups.data?.groups.map((group) => (
        <section className={styles.banner} key={group.templateVersionId}>
          <NodeIndexOutlined className={styles.icon} aria-hidden />
          <div className={styles.copy}>
            <strong>{group.objects.length} 张模板业务表等待发布</strong>
            <p>{group.objects.map((object) => object.name).join("、")}</p>
            <small>一并检查并发布关联流程，已发布业务表保持现状</small>
          </div>
          <Button type="primary" onClick={() => setSelected(group)}>
            发布初始化流程
          </Button>
        </section>
      ))}
      <Modal
        open={Boolean(selected)}
        title="发布初始化流程"
        width={OVERLAY_SIZE.form}
        onCancel={() => {
          if (!publish.isPending) setSelected(undefined);
        }}
        maskClosable={!publish.isPending}
        closable={!publish.isPending}
        keyboard={!publish.isPending}
        okText={`确认发布 ${selected?.objects.length ?? 0} 张表`}
        cancelText="取消"
        confirmLoading={publish.isPending}
        cancelButtonProps={{ disabled: publish.isPending }}
        okButtonProps={{
          disabled: !selected || refreshRequired || groups.isFetching,
        }}
        onOk={() => {
          if (
            selected &&
            !refreshRequired &&
            !groups.isFetching &&
            !publish.isPending
          )
            publish.mutate(selected);
        }}
      >
        <div className={styles.content}>
          <p>
            以下业务表及关联流程将一起生效。所有配置通过检查后才发布；若有问题，整组保持未发布状态。
          </p>
          <ul className={styles.objects}>
            {selected?.objects.map((object) => (
              <li key={object.id}>
                <strong>{object.name}</strong>
                <code>{object.code}</code>
              </li>
            ))}
          </ul>
          <Alert
            type="info"
            showIcon
            title="只发布本次模板初始化的草稿"
            description="不会改写已发布业务表和业务记录。工作台需在工作台配置页单独确认并发布。"
          />
          {error ? (
            <Alert
              type="error"
              showIcon
              title="本次发布未完成"
              description={
                <div>
                  <p>
                    {error.message}（请求编号：{error.requestId}）
                  </p>
                  {Object.entries(error.fieldErrors).map(([path, messages]) => (
                    <p key={path}>
                      <code>{path}</code>：{messages.join("；")}
                    </p>
                  ))}
                  <Button
                    loading={groups.isFetching}
                    onClick={async () => {
                      setSelected(undefined);
                      const result = await groups.refetch();
                      if (result.isSuccess) {
                        setSelected(undefined);
                        setError(undefined);
                        setRefreshRequired(false);
                      }
                    }}
                  >
                    重新读取配置
                  </Button>
                </div>
              }
            />
          ) : null}
        </div>
      </Modal>
    </>
  );
}
