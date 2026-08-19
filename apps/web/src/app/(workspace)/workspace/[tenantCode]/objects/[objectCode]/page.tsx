import { PagePlaceholder } from "@/components/layout/page-placeholder";

export interface ObjectPageProps {
  params: Promise<{ objectCode: string; tenantCode: string }>;
}

export default async function ObjectPage({ params }: ObjectPageProps) {
  const { objectCode } = await params;

  return (
    <PagePlaceholder
      title="业务对象"
      description={`当前对象路由：${objectCode}`}
    />
  );
}
