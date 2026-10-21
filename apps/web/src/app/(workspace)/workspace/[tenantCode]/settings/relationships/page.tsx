import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RelationshipOverview } from "@/features/automations/relationship-overview";
import { requireWorkspace } from "@/lib/auth/require-workspace";
import styles from "@/features/automations/automations.module.css";

export default async function RelationshipsPage({params}:{params:Promise<{tenantCode:string}>}){
 const {tenantCode}=await params;
 const workspace=await requireWorkspace(tenantCode);
 if(workspace.role!=="TENANT_ADMIN")notFound();
 return <main className={styles.panel}><Link href={`/workspace/${tenantCode}/settings/objects`}>返回业务表管理</Link><PageHeader title="业务表关系" description="让数据按公司的业务流程衔接"/><RelationshipOverview tenantCode={tenantCode}/></main>;
}
