import type { Metadata } from "next";

import { LandingPage } from "@/features/landing/landing-page";

const TITLE = "百杰 CRM：线索有人领，跟进有期限，表格按你的业务来搭";
const DESCRIPTION =
  "百杰 CRM 是给中小团队用的客户管理工作区。管理员自己搭业务表、字段和权限；线索放进公海，同事领取、联系、跟进，到期没推进的自动收回。支持 Excel 导入、流程、站内提醒和需确认后执行的 AI 助手。";

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
