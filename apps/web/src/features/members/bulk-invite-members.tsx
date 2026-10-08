"use client";

import { Alert, Button, Drawer, Input, Space, Table, Typography } from "antd";
import { useRef, useState } from "react";
import { runMemberBatch, type MemberBatchRow } from "./member-batch";
import {
  MEMBER_IMPORT_MAX_BYTES,
  parseMemberImport,
  type MemberImportRow,
} from "./member-import";
import type { MemberApi } from "./member-table";

export function BulkInviteMembers({
  tenantCode,
  api,
  onChanged,
}: {
  tenantCode: string;
  api: MemberApi;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<MemberBatchRow<MemberImportRow>[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const submitted = rows.some((row) => row.status !== "pending");
  function preview(value: string) {
    setText(value);
    setRows([]);
    setError(undefined);
    try {
      setRows(
        parseMemberImport(value).rows.map((item) => ({
          item,
          status: "pending",
        })),
      );
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message !== "CSV_UNCLOSED_QUOTE"
          ? caught.message
          : "名单格式有误，请检查引号是否成对。",
      );
    }
  }
  async function submit() {
    if (running.current || !rows.length || rows.some((row) => row.item.error))
      return;
    running.current = true;
    setBusy(true);
    try {
      await runMemberBatch(
        rows,
        (item) =>
          api.invite(tenantCode, {
            phone: item.phone,
            displayName: item.displayName,
            role: item.role,
          }),
        setRows,
      );
      onChanged();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>
        批量邀请
      </Button>
      <Drawer
        title="批量邀请成员"
        open={open}
        size={760}
        onClose={() => {
          if (!running.current) setOpen(false);
        }}
        closable={!busy}
        mask={{ closable: !busy }}
        keyboard={!busy}
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <p>
            从表格复制包含表头的名单，或上传 UTF-8 CSV。每批最多 100
            人，角色留空默认为员工。
          </p>
          <Input.TextArea
            aria-label="成员名单"
            rows={6}
            value={text}
            disabled={busy || submitted}
            placeholder={"姓名\t手机号\t角色\n张三\t13800138000\t员工"}
            onChange={(event) => {
              setText(event.target.value);
              setRows([]);
              setError(undefined);
            }}
          />
          <Space wrap>
            <Button
              disabled={busy || submitted || !text.trim()}
              onClick={() => preview(text)}
            >
              校验并预览
            </Button>
            <label>
              上传 CSV{" "}
              <input
                aria-label="上传成员 CSV"
                type="file"
                accept=".csv,text/csv"
                disabled={busy || submitted}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (
                    !/\.csv$/i.test(file.name) ||
                    file.size > MEMBER_IMPORT_MAX_BYTES
                  ) {
                    setRows([]);
                    setError("请上传不超过 1 MB 的 CSV 文件。");
                    return;
                  }
                  try {
                    preview(await file.text());
                  } catch {
                    setError("无法读取文件，请重试。");
                  }
                }}
              />
            </label>
            {submitted && (
              <Button
                disabled={busy}
                onClick={() => {
                  setRows([]);
                  setText("");
                  setError(undefined);
                }}
              >
                开始新名单
              </Button>
            )}
          </Space>
          {error && <Alert type="error" showIcon title={error} />}
          {rows.length > 0 && (
            <Table
              pagination={false}
              size="small"
              rowKey={(row) => row.item.line}
              dataSource={rows}
              scroll={{ x: 705 }}
              columns={[
                { title: "行", render: (_, row) => row.item.line, width: 50 },
                {
                  title: "姓名",
                  width: 120,
                  render: (_, row) => row.item.displayName,
                },
                {
                  title: "手机号",
                  width: 165,
                  render: (_, row) => row.item.phone,
                },
                {
                  title: "角色",
                  width: 110,
                  render: (_, row) =>
                    row.item.role === "TENANT_ADMIN" ? "公司管理员" : "员工",
                },
                {
                  title: "结果",
                  width: 260,
                  render: (_, row) =>
                    row.item.error ||
                    row.error ||
                    (row.status === "success" ? "已邀请" : "待邀请"),
                },
              ]}
            />
          )}
          <Button
            type="primary"
            loading={busy}
            disabled={
              !rows.length ||
              rows.some((row) => row.item.error) ||
              rows.every((row) => row.status === "success")
            }
            onClick={() => void submit()}
          >
            {submitted
              ? "重试失败行"
              : `确认邀请${rows.length ? ` ${rows.length} 人` : ""}`}
          </Button>
          {submitted && (
            <Alert
              type="info"
              showIcon
              title={`已邀请 ${rows.filter((row) => row.status === "success").length} 人，失败 ${rows.filter((row) => row.status === "error").length} 人`}
              description={
                <>
                  请将注册链接发给员工。新员工使用受邀手机号获取验证码、设置密码并接受邀请；已有账号直接登录接受邀请。邀请不会自动发送短信。
                  <br />
                  <Typography.Text copyable>
                    {typeof window === "undefined"
                      ? ""
                      : `${window.location.origin}/register`}
                  </Typography.Text>
                </>
              }
            />
          )}
        </Space>
      </Drawer>
    </>
  );
}
