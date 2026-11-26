import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import localFont from "next/font/local";
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

/* Latin letters and figures in Inter (tabular figures for amounts and dates);
   Chinese falls through to the system face (PingFang SC / Noto Sans SC). */
const inter = localFont({
  src: "./fonts/inter.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
  fallback: ["PingFang SC", "Noto Sans SC", "Microsoft YaHei", "sans-serif"],
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
