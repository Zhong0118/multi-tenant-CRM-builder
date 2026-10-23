import type { Metadata } from "next";

import { LandingPage } from "@/features/landing/landing-page";

const TITLE = "百杰 CRM：按你的业务搭建的客户管理工作区";
const DESCRIPTION =
  "百杰 CRM 是可配置的客户管理工作区：管理员自己搭建业务表、字段和权限；线索在公海里领取、限时联系，跟进和任务按时提醒，团队进展来自系统记录。支持 Excel 导入、跨表自动化和需你确认后才执行的 AI 助手。";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: "百杰 CRM",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function Home() {
  return <LandingPage />;
}
