"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Tag, Typography } from "antd";
import Link from "next/link";
import { useState } from "react";

import { toApiError } from "@/lib/api/api-error";

import { browserTemplateApi, type TemplateApi } from "./template-api";
import {
  addObject,
  reorderObjects,
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
  const [draft, setDraft] = useState(() => templateDraftFromDetail(initialTemplate));
  const [versions, setVersions] = useState(initialVersions);
  const [activeObjectId, setActiveObjectId] = useState<string | undefined>(
    initialTemplate.configuration.objects[0]?.id,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [analysis, setAnalysis] = useState<TemplatePublicationAnalysis>();
  const [error, setError] = useState<string>();
  const [panelError, setPanelError] = useState<string>();

  const archived = template.status === "ARCHIVED";

  function changeDraft(next: TemplateDraft) {
    setDraft(next);
    setDirty(true);
    setError(undefined);
    setAnalysis(undefined);
  }

  function createObject() {
    const next = addObject(draft);
    const created = next.objects.at(-1);
    changeDraft(next);
    setActiveObjectId(created?.object.id);
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
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.saveDraft(template.id, {
        expectedVersion: template.draftVersion,
        name: template.name,
        description: template.description,
        configuration: toTemplateConfiguration(draft),
      });
      const nextDraft = templateDraftFromDetail(saved);
      setTemplate(saved);
      setDraft(nextDraft);
      setDirty(false);
      setActiveObjectId((current) =>
        nextDraft.objects.some((item) => item.object.id === current)
          ? current
          : nextDraft.objects[0]?.object.id,
      );
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
      const [refreshedTemplate, refreshedVersions] = await Promise.all([
        api.detail(template.id),
        api.listVersions(template.id),
      ]);
      const refreshedDraft = templateDraftFromDetail(refreshedTemplate);
      setTemplate(refreshedTemplate);
      setVersions(refreshedVersions);
      setDraft(refreshedDraft);
      setDirty(false);
      setActiveObjectId((current) =>
        refreshedDraft.objects.some((item) => item.object.id === current)
          ? current
          : refreshedDraft.objects[0]?.object.id,
      );
      setPanelOpen(false);
      setAnalysis(undefined);
      void queryClient.invalidateQueries({
        queryKey: ["platform", "business-templates"],
        exact: false,
      });
    } catch (caught) {
      const apiError = toApiError(caught);
      setPanelError(`${apiError.message}（请求编号：${apiError.requestId}）`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className={styles.editorPage}>
      <p className={styles.desktopOnly}>
        模板包含多个对象和字段，请在宽度至少 1024px 的桌面端完成编辑。
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
            <Tag color={dirty ? "warning" : "success"}>
              {dirty ? "有未保存变更" : "草稿已保存"}
            </Tag>
            <Tag color={template.hasUnpublishedChanges ? "gold" : undefined}>
              {template.hasUnpublishedChanges ? "有未发布变更" : "草稿与发布版本一致"}
            </Tag>
            <span className={styles.publicationIdentity}>
              {template.activeVersion
                ? `v${template.activeVersion.versionNo} 当前发布身份`
                : "尚无发布身份"}
            </span>
          </div>
        </div>
        <div className={styles.editorActions}>
          <Button disabled={!dirty || archived} loading={saving} onClick={saveDraft}>
            保存草稿
          </Button>
          <Button
            type="primary"
            disabled={dirty || archived || draft.objects.length === 0}
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

      <div className={styles.templateDesigner}>
        <aside className={styles.manifestRail} aria-label="模板对象清单">
          <div className={styles.manifestHeader}>
            <div>
              <span>模板清单</span>
              <strong>{draft.objects.length} 个对象</strong>
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
                    <span className={styles.manifestOrder}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.manifestName}>{item.object.name}</span>
                    <span className={styles.manifestCode}>{item.object.code}</span>
                    <span className={styles.manifestFacts}>
                      {item.fields.length} 个字段 · {complete ? "配置完整" : "待完善"}
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
          <Button block onClick={createObject}>
            新建业务对象
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
              <h2>模板还没有业务对象</h2>
              <p>新建第一个业务对象，然后依次配置字段、列表视图和员工权限。</p>
              <Button type="primary" onClick={createObject}>
                新建第一个业务对象
              </Button>
            </section>
          )}
        </div>
      </div>

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

function objectComplete(object: TemplateDraft["objects"][number]): boolean {
  const activeFields = object.fields.filter((field) => field.status === "ACTIVE");
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
