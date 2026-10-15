# 员工列权限与大分页

本地分支 codex/member-field-access，基于已部署 908056c。用户授权实现六档分页、多选员工设置表及列权限；本轮不部署，不改线上数据。保留 docs/user-guide/。

## 产品规则

公司共享业务表；记录负责人是成员关系，创建者与负责人不同。查看/修改操作开关、记录范围 ALL/OWN/NONE、列 EDIT/READ_ONLY/HIDDEN 共同生效。公司管理员仍完整访问。未分配不自动公开；公共池是单独状态。

分页档位 20/50/100/300/500/1000，默认20，后端和URL最大1000。批量修改和分配仍一次最多100条，超过时明确提示并禁用提交入口，不偷偷截断选中项。导入自动分批、AI每次查询上限均不改变。

成员例外可放开默认隐藏列，也可收紧；未覆盖的列跟随最新已发布默认。系统列不可覆盖。无表/记录读取权时，列权限不能让记录可见；列EDIT不突破表的修改范围。多选员工一次设置，未选员工和未提交列不变。支持恢复跟随默认；成员例外立即生效，默认表/列权限仍需发布。这里只做批量应用，不新增部门或权限组实体。

## 技术边界与契约

新增 MemberFieldPermission 技术表（tenantId/objectId/fieldId/memberId/access），复合外键、唯一键、RLS和crm_app授权；不改变业务记录。已发布对象仓库加载当前成员列覆盖，统一 resolveEffectiveAccess 应用，确保列表/详情/查询/导出/AI/流程遵守。字段键不可变，以已发布字段校验。

现有 MemberObjectAccessResponseDto 增加 fields 数组：{fieldId,fieldKey,label,isSystem,inherited,effective,override}，访问值 EDIT/READ_ONLY/HIDDEN；override 可null。既有单个成员表权限接口保持兼容。

新增 PATCH /api/v1/workspaces/{tenantCode}/objects/{objectId}/member-access：
{memberIds: UUID[] (1..100唯一), objectAccess?: MemberObjectAccessDto, fields?: [{fieldId:UUID,access:EDIT|READ_ONLY|HIDDEN|INHERIT}]}
返回 {updated:number}。至少提交一个有效修改。objectAccess 不提交则保留现有表覆盖；INHERIT删除表覆盖（列单独处理）；fields仅处理给出的列，INHERIT删除对应列覆盖。校验本公司有效员工、当前管理员、已发布对象/字段，整批事务成功或失败，审计每位员工前后权限，稳定顺序锁成员以避免竞争。

UI：成员名册勾选多名有效员工 → 批量设置访问权限 → 选择业务表 → 配置表/列变化 → 保存立即生效。显示选中人数、默认权限、未修改保留提示和错误。单成员访问页也显示当前列权限，并可进入同一编辑器（一个成员）修改。沿用AntD样式/抽屉动效，无新增依赖。

AI已经使用授权后的领域读取工具返回字段值；来源链接仅辅助核对。只核实和说明，不新增全库扫描或修改AI读取上限。

## 验收

多选/单选/恢复默认；其他员工不变；隐藏内容不能从列表、详情、导出、AI读工具返回或用于筛选排序；只读写入拒绝；OWN和表禁读仍限制；越租户/禁用成员/系统列/无效字段/部分非法目标整批拒绝；数据库迁移仅新增权限表；分页1000可读、1001拒绝且URL不截成100。局部测试、类型检查、契约、隔离数据库集成、浏览器桌面/手机。
