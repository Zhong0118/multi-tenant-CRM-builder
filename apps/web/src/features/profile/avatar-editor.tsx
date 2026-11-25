"use client";

import { Alert, Button, Modal, Popconfirm, Slider, Space } from "antd";
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

const STAGE = 256;

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
  const large = useRef<HTMLCanvasElement>(null);
  const small = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number }>(
    undefined,
  );
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
    ctx.clearRect(0, 0, STAGE, STAGE);
    ctx.drawImage(
      source,
      ((source.width - side) * x) / 100,
      ((source.height - side) * y) / 100,
      side,
      side,
      0,
      0,
      STAGE,
      STAGE,
    );
    // The two sizes the avatar is actually seen at, drawn from the stage.
    for (const preview of [large.current, small.current]) {
      const target = preview?.getContext("2d");
      if (!preview || !target) continue;
      target.clearRect(0, 0, preview.width, preview.height);
      target.drawImage(canvas.current!, 0, 0, preview.width, preview.height);
    }
  }, [source, x, y, zoom]);
  /** Moves the crop by a pointer or key delta measured on the stage. */
  function pan(from: { x: number; y: number }, dx: number, dy: number) {
    if (!source || !canvas.current) return;
    const side = Math.min(source.width, source.height) / zoom;
    const scale = side / canvas.current.getBoundingClientRect().width;
    const clamp = (value: number) => Math.min(100, Math.max(0, value));
    if (source.width > side)
      setX(clamp(from.x - ((dx * scale) / (source.width - side)) * 100));
    if (source.height > side)
      setY(clamp(from.y - ((dy * scale) / (source.height - side)) * 100));
  }
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
      width={480}
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
      <div className={styles.crop}>
        <div className={styles.stage}>
          <canvas
            className={styles.preview}
            ref={canvas}
            width={STAGE}
            height={STAGE}
            tabIndex={0}
            role="img"
            aria-label="头像裁剪区，拖动图片或用方向键调整位置"
            onPointerDown={(e) => {
              if (busy) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              drag.current = { px: e.clientX, py: e.clientY, x, y };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              pan(
                drag.current,
                e.clientX - drag.current.px,
                e.clientY - drag.current.py,
              );
            }}
            onPointerUp={() => (drag.current = undefined)}
            onPointerCancel={() => (drag.current = undefined)}
            onKeyDown={(e) => {
              const step = {
                ArrowLeft: [-8, 0],
                ArrowRight: [8, 0],
                ArrowUp: [0, -8],
                ArrowDown: [0, 8],
              }[e.key];
              if (!step || busy) return;
              e.preventDefault();
              pan({ x, y }, step[0], step[1]);
            }}
          />
        </div>
        <div className={styles.previews} aria-hidden>
          <canvas ref={large} width={96} height={96} />
          <canvas ref={small} width={64} height={64} />
          <span>预览</span>
        </div>
      </div>
      <label className={styles.slider}>
        <span>缩放</span>
        <Slider
          min={1}
          max={4}
          step={0.05}
          value={zoom}
          disabled={busy || !source}
          tooltip={{ open: false }}
          ariaLabelForHandle="缩放"
          onChange={(value) => setZoom(value)}
        />
      </label>
      <p className={styles.cropHint}>
        拖动图片调整位置，圆圈内的部分就是头像。
      </p>
      {error && <Alert type="error" title={error} />}
    </Modal>
  );
}
