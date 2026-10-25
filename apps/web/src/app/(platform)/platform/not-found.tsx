import { RouteNotFound } from "@/components/feedback/route-states";

export default function PlatformNotFound() {
  return (
    <RouteNotFound
      title="页面不存在"
      description="地址可能有误，或这条记录已被删除。"
      homeHref="/platform"
      homeLabel="返回总览"
    />
  );
}
