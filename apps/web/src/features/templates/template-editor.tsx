"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Typography } from "antd";
import Link from "next/link";
import { useRef, useState } from "react";

import { StatusTag } from "@/components/workbench/status-tag";
import { toApiError } from "@/lib/api/api-error";

import { browserTemplateApi, type TemplateApi } from "./template-api";
import {
  addObject,
  isTemplateObjectCode,
  reorderObjects,
  TEMPLATE_OBJECT_CODE_MESSAGE,
  templateDraftFromDetail,
  toTemplateConfiguration,
  type TemplateDraft,
} from "./template-draft";
import { TemplateObjectEditor } from "./template-object-editor";
import { TemplatePublicationPanel } from "./template-publication-panel";
import type {
  BusinessTemplateDetail,
  BusinessTemplateVersion,
  TemplatePublicationAnalysis,
} from "./template-types";

import styles from "./templates.module.css";

export interface TemplateEditorProps {
  initialTemplate: BusinessTemplateDetail;
  initialVersions: BusinessTemplateVersion[];
  api?: TemplateApi;
}

export function TemplateEditor({
  initialTemplate,
  initialVersions,
  api = browserTemplateApi,
}: TemplateEditorProps) {
  const queryClient = useQueryClient();
  const [template, setTemplate] = useState(initialTemplate);
  const initialDraft = templateDraftFromDetail(initialTemplate);
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const localRevision = useRef(0);
  const [versions, setVersions] = useState(initialVersions);
  const [activeObjectId, setActiveObjectId] = useState<string | undefined>(
    initialTemplate.configuration.objects[0]?.id,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [newObjectName, setNewObjectName] = useState("");
  const [newObjectCode, setNewObjectCode] = useState("");
  const [newObjectDescription, setNewObjectDescription] = useState("");
  const [analysis, setAnalysis] = useState<TemplatePublicationAnalysis>();
  const [error, setError] = useState<string>();
  const [panelError, setPanelError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [publicationRefreshRequired, setPublicationRefreshRequired] =
    useState(false);

  const archived = template.status === "ARCHIVED";
  const hasInvalidObjectCode = draft.objects.some(
    (item) => !isTemplateObjectCode(item.object.code),
  );

  function changeDraft(next: TemplateDraft) {
    localRevision.current += 1;
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setError(undefined);
    setAnalysis(undefined);
  }

  const duplicateObjectCode = draft.objects.some(
    (item) => item.object.code === newObjectCode.trim(),
  );
  const newObjectCodeInvalid =
    newObjectCode.trim().length > 0 &&
    !isTemplateObjectCode(newObjectCode.trim());
  const canCreateObject =
    newObjectName.trim().length > 0 &&
    newObjectCode.trim().length > 0 &&
    !newObjectCodeInvalid &&
    !duplicateObjectCode;

  function openObjectCreator() {
    setNewObjectName("");
    setNewObjectCode(nextObjectCode(draft));
    setNewObjectDescription("");
    setCreatorOpen(true);
  }

  function createObject() {
    if (!canCreateObject) return;
    const next = addObject(draft, {
      name: newObjectName.trim(),
      code: newObjectCode.trim(),
      description: newObjectDescription.trim() || null,
    });
    const created = next.objects.at(-1);
    changeDraft(next);
    setActiveObjectId(created?.object.id);
    setCreatorOpen(false);
  }

  function moveObject(objectId: string, direction: -1 | 1) {
    const objectIds = draft.objects.map((item) => item.object.id);
    const from = objectIds.indexOf(objectId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= objectIds.length) return;
    [objectIds[from], objectIds[to]] = [objectIds[to]!, objectIds[from]!];
    changeDraft(reorderObjects(draft, objectIds));
  }

  async function saveDraft() {
    const savingRevision = localRevision.current;
    const savingDraft = draftRef.current;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.saveDraft(template.id, {
        expectedVersion: template.draftVersion,
        name: template.name,
        description: template.description,
        configuration: toTemplateConfiguration(savingDraft),
      });
      if (localRevision.current === savingRevision) {
        const nextDraft = templateDraftFromDetail(saved);
        draftRef.current = nextDraft;
        setTemplate(saved);
        setDraft(nextDraft);
        setDirty(false);
        setActiveObjectId((current) =>
          nextDraft.objects.some((item) => item.object.id === current)
            ? current
            : nextDraft.objects[0]?.object.id,
        );
      } else {
        setTemplate((current) => ({
          ...current,
          draftVersion: saved.draftVersion,
          updatedAt: saved.updatedAt,
          hasUnpublishedChanges: saved.hasUnpublishedChanges,
          status: saved.status,
        }));
        setDirty(true);
      }
      void queryClient.invalidateQueries({
        queryKey: ["platform", "business-templates"],
        exact: false,
      });
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    } finally {
      setSaving(false);
    }
  }

  async function openPublicationPanel() {
    setPanelOpen(true);
    setAnalysis(undefined);
    setPanelError(undefined);
    setAnalyzing(true);
    try {
      setAnalysis(
        await api.analyzePublication(template.id, template.draftVersion),
      );
    } catch (caught) {
      const apiError = toApiError(caught);
      setPanelError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    } finally {
      setAnalyzing(false);
    }
  }

  async function publishTemplate() {
    setPublishing(true);
    setPanelError(undefined);
    try {
      await api.publish(template.id, template.draftVersion);
      setPanelOpen(false);
      setAnalysis(undefined);
      setPublicationRefreshRequired(true);
    } catch (caught) {
      const apiError = toApiError(caught);
      setPanelError(`${apiError.message}（请求编号：${apiError.requestId}）`);
      return;
    } finally {
      setPublishing(false);
    }
    await refreshPublishedTemplate();
  }

  async function refreshPublishedTemplate() {
    const refreshRevision = localRevision.current;
    const wasDirtyAtRefreshStart = dirty;
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      const [refreshedTemplate, refreshedVersions] = await Promise.all([
        api.detail(template.id),
        api.listVersions(template.id),
      ]);
      setTemplate(refreshedTemplate);
      setVersions(refreshedVersions);
      if (
        !wasDirtyAtRefreshStart &&
        localRevision.current === refreshRevision
      ) {
        const refreshedDraft = templateDraftFromDetail(refreshedTemplate);
        draftRef.current = refreshedDraft;
        setDraft(refreshedDraft);
        setDirty(false);
        setActiveObjectId((current) =>
          refreshedDraft.objects.some((item) => item.object.id === current)
            ? current
            : refreshedDraft.objects[0]?.object.id,
        );
      }
      setPublicationRefreshRequired(false);
      void queryClient.invalidateQueries({
        queryKey: ["platform", "business-templates"],
        exact: false,
      });
    } catch (caught) {
      const apiError = toApiError(caught);
      setRefreshError(`${apiError.message}（请求编号：${apiError.requestId}）`);
      setPublicationRefreshRequired(true);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className={styles.editorPage}>
      <p className={styles.desktopOnly}>
        模板包含多张业务表和字段，请在宽度至少 1024px 的桌面端完成编辑。
      </p>

      <header className={styles.editorHeader}>
        <div className={styles.editorIdentity}>
          <Link href="/platform/templates" className={styles.backLink}>
            返回业务模板
          </Link>
          <div className={styles.identityLine}>
            <h1>{template.name}</h1>
            <span className={styles.code}>{template.code}</span>
          </div>
          <div className={styles.editorMeta}>
            <StatusTag tone={dirty ? "warning" : "success"}>
              {dirty ? "有未保存变更" : "草稿已保存"}
            </StatusTag>
            <StatusTag
              tone={template.hasUnpublishedChanges ? "warning" : "neutral"}
            >
              {template.hasUnpublishedChanges
                ? "有未发布变更"
                : "草稿与发布版本一致"}
            </StatusTag>
            <span className={styles.publicationIdentity}>
              {template.activeVersion
                ? `v${template.activeVersion.versionNo} 当前发布身份`
                : "尚无发布身份"}
            </span>
          </div>
        </div>
        <div className={styles.editorActions}>
          <Button
            aria-label="保存草稿"
            disabled={!dirty || archived || hasInvalidObjectCode}
            loading={saving}
            onClick={saveDraft}
          >
            保存草稿
          </Button>
          <Button
            type="primary"
            aria-label="发布模板"
            disabled={
              dirty ||
              archived ||
              publicationRefreshRequired ||
              !template.hasUnpublishedChanges
            }
            loading={analyzing}
            onClick={openPublicationPanel}
          >
            发布模板
          </Button>
        </div>
      </header>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="草稿未保存，本地编辑仍然保留"
          description={error}
        />
      ) : null}

      {refreshError ? (
        <Alert
          type="warning"
          showIcon
          title="模板已发布，但页面刷新失败"
          description={
            <div>
              <p>{refreshError}</p>
              <Button loading={refreshing} onClick={refreshPublishedTemplate}>
                重试刷新
              </Button>
            </div>
          }
        />
      ) : null}

      <div className={styles.templateDesigner}>
        <aside className={styles.manifestRail} aria-label="模板业务表清单">
          <div className={styles.manifestHeader}>
            <div>
              <span>业务表清单</span>
              <strong>{draft.objects.length} 张表</strong>
            </div>
            <Typography.Text type="secondary">
              顺序会随完整聚合一起保存
            </Typography.Text>
          </div>
          <div className={styles.manifestList}>
            {draft.objects.map((item, index) => {
              const active = item.object.id === activeObjectId;
              const complete = objectComplete(item);
              return (
                <div
                  key={item.object.id}
                  className={`${styles.manifestItem} ${
                    active ? styles.manifestItemActive : ""
                  }`}
                >
                  <button
                    type="button"
                    className={styles.manifestSelect}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setActiveObjectId(item.object.id)}
                  >
                    <span className={styles.manifestOrder}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.manifestName}>
                      {item.object.name}
                    </span>
                    <span className={styles.manifestCode}>
                      {item.object.code}
                    </span>
                    <span className={styles.manifestFacts}>
                      {item.fields.length} 个字段 ·{" "}
                      {complete ? "配置完整" : "待完善"}
                    </span>
                    {item.object.publishedCode ? (
                      <span className={styles.identityLock}>发布身份已锁</span>
                    ) : null}
                  </button>
                  <div className={styles.manifestMove}>
                    <Button
                      type="text"
                      size="small"
                      aria-label={`上移 ${item.object.name}`}
                      disabled={index === 0}
                      onClick={() => moveObject(item.object.id, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      aria-label={`下移 ${item.object.name}`}
                      disabled={index === draft.objects.length - 1}
                      onClick={() => moveObject(item.object.id, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <Button type="primary" block onClick={openObjectCreator}>
            新增业务表
          </Button>
        </aside>

        <div className={styles.editorWorkspace}>
          {activeObjectId ? (
            <TemplateObjectEditor
              key={activeObjectId}
              draft={draft}
              objectId={activeObjectId}
              onChange={changeDraft}
            />
          ) : (
            <section className={styles.workspaceEmpty}>
              <h2>模板还没有业务表</h2>
              <p>先确定这张表记录什么，再配置字段、列表视图和员工权限。</p>
              <Button type="primary" onClick={openObjectCreator}>
                新增第一张业务表
              </Button>
            </section>
          )}
        </div>
      </div>

      <Modal
        open={creatorOpen}
        centered
        width={680}
        title="新增业务表"
        okText="创建并配置"
        cancelText="取消"
        okButtonProps={{ disabled: !canCreateObject }}
        onOk={createObject}
        onCancel={() => setCreatorOpen(false)}
        destroyOnHidden
      >
        <div className={styles.objectCreator}>
          <Form component={false} layout="vertical">
            <Form.Item
              label="业务表名称"
              htmlFor="new-template-object-name"
              extra="使用公司管理员和员工都能理解的业务名称，例如客户、跟单或回访记录。"
            >
              <Input
                id="new-template-object-name"
                autoFocus
                placeholder="例如：回访记录"
                value={newObjectName}
                onChange={(event) => setNewObjectName(event.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="业务表代码"
              htmlFor="new-template-object-code"
              validateStatus={
                newObjectCodeInvalid || duplicateObjectCode
                  ? "error"
                  : undefined
              }
              help={
                duplicateObjectCode
                  ? "该代码已在模板中使用。"
                  : newObjectCodeInvalid
                    ? TEMPLATE_OBJECT_CODE_MESSAGE
                    : undefined
              }
              extra="代码用于稳定标识这张表，发布后不能修改。"
            >
              <Input
                id="new-template-object-code"
                className={styles.code}
                value={newObjectCode}
                onChange={(event) => setNewObjectCode(event.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="用途说明"
              htmlFor="new-template-object-description"
              extra="说明这张表由谁维护、记录什么内容。后续仍可调整。"
            >
              <Input.TextArea
                id="new-template-object-description"
                rows={3}
                placeholder="例如：销售人员登记每次客户回访及下一步安排。"
                value={newObjectDescription}
                onChange={(event) =>
                  setNewObjectDescription(event.target.value)
                }
              />
            </Form.Item>
          </Form>
          <aside className={styles.creatorGuide} aria-label="创建后配置步骤">
            <span className={styles.eyebrow}>CREATION FLOW</span>
            <h3>创建后还需要完成</h3>
            <ol>
              <li>添加并设置字段</li>
              <li>确定默认列表视图</li>
              <li>设置员工动作与数据范围</li>
              <li>保存草稿并发布模板</li>
            </ol>
            <p>
              创建业务表不会立即影响任何公司，只有发布模板并应用后才会生成公司草稿。
            </p>
          </aside>
        </div>
      </Modal>

      <TemplatePublicationPanel
        open={panelOpen}
        draft={draft}
        analysis={analysis}
        versions={versions}
        loading={analyzing}
        publishing={publishing}
        error={panelError}
        onConfirm={publishTemplate}
        onClose={() => {
          setPanelOpen(false);
          setAnalysis(undefined);
          setPanelError(undefined);
        }}
      />
    </main>
  );
}

function nextObjectCode(draft: TemplateDraft): string {
  let index = draft.objects.length + 1;
  while (draft.objects.some((item) => item.object.code === `object-${index}`)) {
    index += 1;
  }
  return `object-${index}`;
}

function objectComplete(object: TemplateDraft["objects"][number]): boolean {
  const activeFields = object.fields.filter(
    (field) => field.status === "ACTIVE",
  );
  return (
    object.object.name.trim().length > 0 &&
    object.object.code.trim().length > 0 &&
    activeFields.length > 0 &&
    activeFields.some(
      (field) =>
        field.fieldKey === object.object.titleFieldKey && field.required,
    ) &&
    object.defaultView !== null &&
    object.employeeAccess !== null
  );
}
