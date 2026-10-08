import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/landing-page";

export const metadata: Metadata = {
  title: "百杰 CRM：把分散的表格，变成团队共同推进的业务",
  description:
    "百杰 CRM 把客户、商机和跟进放进同一个工作区：每条记录有负责人，每次沟通留在记录上，下一步跟进有时间。目前仅接受受邀用户注册。",
};

export default function Home() {
  return <LandingPage />;
}
