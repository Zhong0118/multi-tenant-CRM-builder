# 通用站内提醒

用户已批准上一轮建议。本轮先本地实现和验证，不自动部署，不发送短信或外部通知，不增加业绩考核规则。沿用当前目录，不增加工作树，不触碰 docs/user-guide/。

## 行为

- 公司工作区右上角消息图标、未读数、抽屉。按类型组织，支持未读/全部、分页、单条已读、全部已读、点击查看相关记录。60 秒轮询，后台标签不轮询，重进页面刷新。错误状态可重试，不静默当作无消息。
- 分阶段公海：联系到期前 min(2 小时, 联系期限/4)，跟进到期前 min(24 小时, 跟进期限/4) 提醒当前负责人。仅未到期、启用中的业务表；到期或转交、续期后旧提示立即不显示。
- 待办到期且 OPEN 时通知当前 assignee。改期、完成、取消、转交或记录不可读后不显示旧提示。
- 自动回收成功在同一事务内通知原负责人。通知只保存系统元数据，不保存客户名称、电话或字段内容；即使原负责人无权看记录也能看到通用回收回执，但不能通过消息越权进入记录。
- 成交保护依据变为待复核时通知该公司的活动管理员；解除待复核则旧提醒失效。再次进入待复核是新一轮提醒。
- 默认每分钟扫描，唯一键避免同一个事件重复通知。重启可补当前待处理提醒；新建消息表不会批量导入历史回收事件。以当前生效权限判断能否读取/跳转，停用成员、用户、公司不可获取消息。

## 存储和安全

同一个 PostgreSQL 新增 member_notifications 表，不新建数据库/服务。不复制客户数据。保存 tenant_id、recipient_member_id、object_id、record_id、follow_up_id、kind、event_key、due_at、created_at、created_xid、read_at、resolved_at。tenant/member/object/record 关系使用同租户外键。

RLS 限制 app 只能读取本人当前公司消息；仅可更新 read_at，禁止由普通运行角色插入、改收件人、删除通知。后台使用专用 NOLOGIN/NOBYPASSRLS 角色和限定 SECURITY DEFINER 函数，锁定 search_path，撤销 PUBLIC 执行权限。扫描只写通知，不修改业务表/客户/权限。回收回执与保护复核用事务内触发器，通知异常回滚，不发送虚假回执。

后台查询必须过滤当前状态；服务端列表/计数还需应用已发布表读取权限及员工 OWN 范围及现有公海读取例外。回收回执仅返回不含敏感字段的固定文案。点击时再次走现有 RecordsService.detail 权限链，不能信任客户端链接。

## API

- GET /api/v1/workspaces/:tenantCode/notifications?page=1&limit=20&unreadOnly=false
  返回 {items,total,unreadCount,page,limit,serverTime,snapshot}。
- items: {id,kind,title,message,createdAt,dueAt:string|null,readAt:string|null,canOpen:boolean}。
- kind: CONTACT_DUE | FOLLOW_UP_DUE | TASK_OVERDUE | POOL_RECLAIMED | PROTECTION_REVIEW。
- PATCH /notifications/:id/read → {ok:true}，本人幂等；他人/跨租户 404。
- POST /notifications/read-all body {before:ISODate,snapshot:string} → {ok:true}，仅标记本次列表数据库快照中已提交的本人有效通知。created_xid 保留创建事务身份，snapshot 参与可见性校验，避免把尚未提交、随后才到达的消息标为已读。
- GET /notifications/:id/target → {href:string|null}。新鲜检查；不可访问返回 null，前端显示不可访问说明。跟进消息链接携带 followUp。

第一版固定提前量，不新增公司通知配置页面，不用 WebSocket/新消息队列/新依赖。已有 Ant Design、React Query 和图标组件复用，抽屉动效、按钮过渡和 reduced-motion 遵循现有风格。

复核通知插入前重新确认当前复核状态，使用父记录共享锁与 SKIP LOCKED 避免业务锁顺序冲突；忙碌时由后续扫描补发。后台角色用于锁定的列级授权配合 RLS WITH CHECK(false)，禁止实际业务更新。
