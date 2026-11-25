"use client";

import { Alert, Button, Modal, Popconfirm, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/api-error";
import { browserApiOrigin } from "@/lib/api/api-origin";
import styles from "./profile.module.css";

async function saveAvatar(method: "PUT" | "DELETE", file?: Blob) {
  const body = new FormData();
  if (file) body.append("file", file, "avatar.webp");
  const response = await fetch(browserApiOrigin() + "/api/v1/me/avatar", {
    method,
    credentials: "include",
    body: file ? body : undefined,
  });
  const data: unknown = await response.json();
  if (!response.ok) throw toApiError(data, response.status);
  return (data as { avatarUrl: string | null }).avatarUrl;
}

export function AvatarEditor({
  avatarUrl,
  onChange,
}: {
  avatarUrl: string | null;
  onChange: (value: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    setDeleting(true);
    setError("");
    try {
      onChange(await saveAvatar("DELETE"));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className={styles.actions}>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="选择头像图片"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          e.target.value = "";
          if (!selected) return;
          if (
            selected.size > 2 * 1024 * 1024 ||
            !["image/jpeg", "image/png", "image/webp"].includes(selected.type)
          ) {
            setError("请选择不超过 2 MB 的 JPEG、PNG 或 WebP 图片");
            return;
          }
          setError("");
          setFile(selected);
        }}
      />
      <Space wrap>
        <Button disabled={deleting} onClick={() => input.current?.click()}>
          {avatarUrl ? "更换头像" : "上传头像"}
        </Button>
        {avatarUrl && (
          <Popconfirm
            title="删除账号头像？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove()}
          >
            <Button type="text" loading={deleting}>
              删除
            </Button>
          </Popconfirm>
        )}
      </Space>
      {error && <Alert type="error" title={error} />}
      {file && (
        <CropAvatar
          file={file}
          onClose={() => setFile(undefined)}
          onSaved={(value) => {
            onChange(value);
            setFile(undefined);
          }}
        />
      )}
    </div>
  );
}

function CropAvatar({
  file,
  onClose,
  onSaved,
}: {
  file: File;
  onClose: () => void;
  onSaved: (url: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<ImageBitmap>();
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true,
      bitmap: ImageBitmap | undefined;
    void createImageBitmap(file)
      .then((image) => {
        if (active) {
          bitmap = image;
          setSource(image);
        } else image.close();
      })
      .catch(() => {
        if (active) setError("无法读取此图片，请重新选择");
      });
    return () => {
      active = false;
      bitmap?.close();
    };
  }, [file]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!source || !ctx) return;
    const side = Math.min(source.width, source.height) / zoom;
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(
      source,
      ((source.width - side) * x) / 100,
      ((source.height - side) * y) / 100,
      side,
      side,
      0,
      0,
      256,
      256,
    );
  }, [source, x, y, zoom]);
  async function save() {
    if (!canvas.current || !source || busy) return;
    const surface = canvas.current;
    setBusy(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        surface.toBlob(resolve, "image/webp", 0.85),
      );
      if (!blob || blob.size > 300 * 1024) {
        setError("图片压缩失败，请重新选择");
        return;
      }
      onSaved(await saveAvatar("PUT", blob));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="裁剪头像"
      onOk={() => void save()}
      onCancel={onClose}
      confirmLoading={busy}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      okButtonProps={{ disabled: !source }}
      cancelButtonProps={{ disabled: busy }}
      okText="保存头像"
      cancelText="取消"
    >
      <canvas
        className={styles.preview}
        ref={canvas}
        width={256}
        height={256}
        aria-label="方形头像预览"
      />
      <label className={styles.slider}>
        缩放
        <input
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          disabled={busy}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
      <label className={styles.slider}>
        水平位置
        <input
          type="range"
          min={0}
          max={100}
          value={x}
          disabled={busy}
          onChange={(e) => setX(Number(e.target.value))}
        />
      </label>
      <label className={styles.slider}>
        垂直位置
        <input
          type="range"
          min={0}
          max={100}
          value={y}
          disabled={busy}
          onChange={(e) => setY(Number(e.target.value))}
        />
      </label>
      {error && <Alert type="error" title={error} />}
    </Modal>
  );
}
