import Icon from "@ant-design/icons";
import type { GetProps } from "antd";

/**
 * The product's one mark for AI (assistant, drafts, suggestions): a four-point
 * spark drawn on the same 24px stroke grid as the outlined icons around it.
 */
function SparkSvg() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4m2-2h-4" />
      <circle cx="4" cy="20" r="2" />
    </svg>
  );
}

export function AiSparkIcon(props: Omit<GetProps<typeof Icon>, "component">) {
  return <Icon component={SparkSvg} {...props} />;
}
