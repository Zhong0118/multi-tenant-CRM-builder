/* One fictional company, 禾木办公家具 (an office-furniture dealer), shared by
   every demo scenario so the workflows read as one business. Nothing here is
   real and nothing leaves the browser. */

export const DEMO_COMPANY = "禾木办公家具";

export type Role = "admin" | "staff";

export interface Viewer {
  name: string;
  role: Role;
}

export const ADMIN: Viewer = { name: "林岚", role: "admin" };
export const STAFF: Viewer = { name: "周航", role: "staff" };

export const COLLEAGUES = ["周航", "唐悦"] as const;

export interface Lead {
  name: string;
  contact: string;
  source: string;
}

/* Already in the 客户 table's lead pool before the import. */
export const POOL_LEADS: Lead[] = [
  { name: "南湖实验学校", contact: "王老师", source: "官网表单" },
  { name: "城东社区医院", contact: "刘主任", source: "转介绍" },
];

/* The spreadsheet the admin imports in the first scenario. Row 3 is missing
   its required name until the visitor fills it in. */
export const IMPORT_ROWS: Lead[] = [
  { name: "启明设计事务所", contact: "陈总", source: "展会" },
  { name: "青禾幼儿园", contact: "孙园长", source: "电话咨询" },
  { name: "", contact: "赵经理", source: "展会" },
];

export const IMPORT_FIX = "北岸物业服务中心";

export const IMPORTED_LEADS: Lead[] = IMPORT_ROWS.map((row) =>
  row.name ? row : { ...row, name: IMPORT_FIX },
);
