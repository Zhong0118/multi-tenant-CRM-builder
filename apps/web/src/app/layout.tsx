import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PUBLIC_ORIGIN } from "@/features/landing/content";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_ORIGIN),
  title: { default: "百杰 CRM", template: "%s · 百杰 CRM" },
  description:
    "给中小团队用的客户管理工作区：自己搭业务表和权限，线索有人领，跟进有期限。",
  applicationName: "百杰 CRM",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
