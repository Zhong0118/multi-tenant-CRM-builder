"use client";

import { UserOutlined } from "@ant-design/icons";
import { useState } from "react";
import { browserApiOrigin } from "@/lib/api/api-origin";
import styles from "./member-identity.module.css";

export function ProfileAvatar({
  name,
  avatarUrl,
  size = 32,
  className,
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const initial = name?.match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase("zh-CN");
  return (
    <span
      aria-hidden
      className={[styles.avatar, styles.profileAvatar, className]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.43) }}
    >
      {avatarUrl && failed !== avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          crossOrigin="use-credentials"
          src={browserApiOrigin() + avatarUrl}
          onError={() => setFailed(avatarUrl)}
        />
      ) : (
        initial || <UserOutlined />
      )}
    </span>
  );
}
