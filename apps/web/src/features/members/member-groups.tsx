"use client";

import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Table,
} from "antd";
import Link from "next/link";
import { useState } from "react";

import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { toApiError } from "@/lib/api/api-error";

import {
  memberGroupsApi,
  type MemberGroup,
  type MemberGroupInput,
  type MemberGroupsApi,
} from "./member-groups-api";
import styles from "./members.module.css";

export function MemberGroups({
  tenantCode,
  api = memberGroupsApi,
}: {
  tenantCode: string;
  api?: MemberGroupsApi;
}) {
  const client = useQueryClient();
  const [form] = Form.useForm<MemberGroupInput>();
  const [editing, setEditing] = useState<MemberGroup | "new">();
  const [removing, setRemoving] = useState<MemberGroup>();
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const groups = useQuery({
    queryKey: ["workspace", tenantCode, "member-groups"],
    queryFn: () => api.list(tenantCode),
    staleTime: 30_000,
  });
  const items = groups.data?.items ?? [];
  const members = groups.data?.members ?? [];
  const activeGroup = editing && editing !== "new" ? editing : undefined;
  const refresh = () => {
    void client.invalidateQueries({
      queryKey: ["workspace", tenantCode, "member-groups"],
    });
    void client.invalidateQueries({
      queryKey: ["workspace", tenantCode, "members"],
    });
  };
  const showError = (caught: unknown) => {
    const apiError = toApiError(caught);
    setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
  };
  const save = useMutation({
    mutationFn: (input: MemberGroupInput) =>
      activeGroup
        ? api.update(tenantCode, activeGroup.id, {
            ...input,
            expectedVersion: activeGroup.version,
          })
        : api.create(tenantCode, input),
    onMutate: () => {
      setError(undefined);
      setFeedback(undefined);
    },
    onError: showError,
    onSuccess: () => {
      setEditing(undefined);
      setFeedback("小组已保存，立即生效");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (group: MemberGroup) =>
      api.remove(tenantCode, group.id, group.version),
    onMutate: () => {
      setError(undefined);
      setFeedback(undefined);
    },
    onError: showError,
    onSuccess: () => {
      setRemoving(undefined);
      setFeedback("小组已解散，成员和业务记录已保留");
      refresh();
    },
  });
  function openEditor(group: MemberGroup | "new") {
    setError(undefined);
    setSelectedIds(group === "new" ? [] : group.memberIds);
    form.resetFields();
    form.setFieldsValue(
      group === "new"
        ? { name: "", memberIds: [], leaderMemberId: null }
        : group,
    );
    setEditing(group);
  }

  return (
    <section className={styles.groupPanel} aria-label="小组管理">
      <div className={styles.groupHeader}>
        <p className={styles.secondary}>
          每位员工最多加入一个小组，组长由公司管理员指定。查看本组记录的权限需按业务表单独授予，保存立即生效。
        </p>
        <Button
          type="primary"
          icon={<PlusOutlined aria-hidden />}
          onClick={() => openEditor("new")}
          disabled={!groups.data || groups.isFetching}
        >
          新建小组
        </Button>
      </div>
      {feedback ? (
        <Alert
          type="success"
          showIcon
          title={feedback}
          className={styles.alert}
        />
      ) : null}
      {groups.error ? (
        <Alert
          type="error"
          showIcon
          title={`小组读取失败：${toApiError(groups.error).message}`}
          action={<Button onClick={() => void groups.refetch()}>重试</Button>}
        />
      ) : null}
      <Table<MemberGroup>
        rowKey="id"
        aria-label="小组列表"
        className={styles.table}
        dataSource={items}
        loading={groups.isFetching}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                groups.error
                  ? "小组暂时无法读取"
                  : "还没有小组，创建后可分配员工和组长"
              }
            />
          ),
        }}
        columns={[
          { title: "小组", dataIndex: "name" },
          {
            title: "组长",
            key: "leader",
            render: (_, group) => {
              const leader = members.find(
                (member) => member.id === group.leaderMemberId,
              );
              return leader ? (
                <span>
                  {leader.displayName}
                  {leader.status !== "ACTIVE" ? "（已停用）" : ""}
                </span>
              ) : (
                <span className={styles.muted}>未设置</span>
              );
            },
          },
          {
            title: "成员",
            key: "count",
            render: (_, group) => `${group.memberIds.length} 人`,
          },
          {
            title: "操作",
            key: "actions",
            render: (_, group) => {
              const leader = members.find(
                (member) => member.id === group.leaderMemberId,
              );
              return (
                <div className={styles.groupActions}>
                  <Button size="small" onClick={() => openEditor(group)}>
                    编辑
                  </Button>
                  {leader?.status === "ACTIVE" && leader.role === "EMPLOYEE" ? (
                    <Link
                      href={`/workspace/${tenantCode}/members/${leader.id}/access`}
                      aria-label={`设置${group.name}组长的访问权限`}
                    >
                      组长权限
                    </Link>
                  ) : null}
                  <Button
                    type="text"
                    size="small"
                    danger
                    onClick={() => {
                      setError(undefined);
                      setRemoving(group);
                    }}
                  >
                    解散
                  </Button>
                </div>
              );
            },
          },
        ]}
      />
      <Drawer
        title={activeGroup ? "编辑小组" : "新建小组"}
        open={editing !== undefined}
        size={OVERLAY_SIZE.drawer}
        rootClassName={styles.accessDrawer}
        destroyOnHidden
        onClose={() => {
          if (!save.isPending) setEditing(undefined);
        }}
        closable={!save.isPending}
        keyboard={!save.isPending}
        mask={{ closable: !save.isPending }}
        footer={
          <div className={styles.groupActions}>
            <Button
              disabled={save.isPending}
              onClick={() => setEditing(undefined)}
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={save.isPending}
              disabled={save.isPending}
              onClick={() => form.submit()}
            >
              保存小组
            </Button>
          </div>
        }
      >
        <p className={styles.drawerNote}>
          小组调整保存即生效，无需发布业务表。成员移入本组时会退出原小组。
        </p>
        {error ? (
          <Alert type="error" showIcon title={error} className={styles.alert} />
        ) : null}
        <Form<MemberGroupInput>
          form={form}
          layout="vertical"
          disabled={save.isPending}
          onFinish={(values) =>
            save.mutate({
              name: values.name.trim(),
              memberIds: values.memberIds ?? [],
              leaderMemberId: values.leaderMemberId ?? null,
            })
          }
        >
          <Form.Item
            label="小组名称"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "请输入小组名称" },
            ]}
          >
            <Input aria-label="小组名称" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="小组成员"
            name="memberIds"
            extra="每位员工只能加入一个小组。其他小组的组长需先更换组长后才能移入。"
          >
            <Select
              aria-label="小组成员"
              mode="multiple"
              showSearch={{ optionFilterProp: "label" }}
              placeholder="选择员工"
              onChange={(ids: string[]) => {
                setSelectedIds(ids);
                if (!ids.includes(form.getFieldValue("leaderMemberId")))
                  form.setFieldValue("leaderMemberId", null);
              }}
              options={members
                .filter(
                  (member) =>
                    member.role === "EMPLOYEE" &&
                    (member.status === "ACTIVE" ||
                      activeGroup?.memberIds.includes(member.id)),
                )
                .map((member) => {
                  const group = items.find(
                    (item) => item.id === member.groupId,
                  );
                  const otherGroup = group && group.id !== activeGroup?.id;
                  const otherLeader =
                    otherGroup && group.leaderMemberId === member.id;
                  return {
                    value: member.id,
                    label: `${member.displayName}${member.status !== "ACTIVE" ? "（已停用）" : ""}${otherGroup ? ` · ${group.name}${otherLeader ? "组长（需先更换）" : ""}` : ""}`,
                    disabled: Boolean(otherLeader),
                  };
                })}
            />
          </Form.Item>
          <Form.Item
            label="组长"
            name="leaderMemberId"
            rules={[
              {
                validator: (_, value) =>
                  !value ||
                  members.some(
                    (member) =>
                      member.id === value &&
                      member.status === "ACTIVE" &&
                      member.role === "EMPLOYEE" &&
                      selectedIds.includes(member.id),
                  )
                    ? Promise.resolve()
                    : Promise.reject(new Error("请选择在职员工担任组长")),
              },
            ]}
            extra="可暂不指定组长；指定时需选择本组在职员工。本组查看范围需按业务表授权，修改范围和列权限独立设置。"
          >
            <Select
              aria-label="组长"
              placeholder="暂无组长，可稍后指定"
              allowClear
              options={members
                .filter(
                  (member) =>
                    selectedIds.includes(member.id) &&
                    member.role === "EMPLOYEE",
                )
                .map((member) => ({
                  value: member.id,
                  label: `${member.displayName}${member.status !== "ACTIVE" ? "（已停用）" : ""}`,
                  disabled: member.status !== "ACTIVE",
                }))}
            />
          </Form.Item>
        </Form>
      </Drawer>
      <Modal
        open={Boolean(removing)}
        title={`解散${removing?.name ?? "小组"}？`}
        okText="确认解散"
        cancelText="取消"
        width={OVERLAY_SIZE.confirm}
        okButtonProps={{ danger: true, disabled: remove.isPending }}
        cancelButtonProps={{ disabled: remove.isPending }}
        confirmLoading={remove.isPending}
        onCancel={() => {
          if (!remove.isPending) setRemoving(undefined);
        }}
        onOk={() => {
          if (removing && !remove.isPending) remove.mutate(removing);
        }}
      >
        <p>
          成员账号和业务记录都会保留，成员变为未分组。原组长的本组查看权限将回退为仅本人负责。
        </p>
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </Modal>
    </section>
  );
}
