"use client";

import { LogoutOutlined } from "@ant-design/icons";
import { Button, message } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { browserApiClient } from "@/lib/api/browser-client";

export function useLogout() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      const { response } = await browserApiClient.POST("/api/v1/auth/logout");
      if (response.ok) {
        router.replace("/login");
        router.refresh();
        return;
      }
      void message.error("退出失败，请稍后重试。");
    } catch {
      void message.error("退出失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return { logout, loading };
}

export function LogoutButton({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const { logout, loading } = useLogout();

  return (
    <Button
      icon={<LogoutOutlined />}
      loading={loading}
      onClick={() => void logout()}
      aria-label="退出登录"
    >
      {iconOnly ? null : "退出登录"}
    </Button>
  );
}
