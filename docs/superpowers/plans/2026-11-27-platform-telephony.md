# 平台电话外呼服务 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PR #94 的「每家公司自填快马账号」改成平台统一线路：平台定通话套餐、给公司开通、按分钟加价转售，系统自动建坐席、按分钟计费、80% / 100% 提醒、每月看收支。

**Architecture:** 直接改写还没上线的迁移 `0066_tenant_telephony`。计费、用量、提醒都放在数据库触发器和只做一件事的 `SECURITY DEFINER` 函数里，由不能登录的 `crm_telephony_writer` 角色持有，做法照搬 0054 的 AI 套餐。API 侧新增平台线路读取（`TelephonyLine`）、自动建坐席（`TelephonySeats`）和平台接口（`TelephonyPlatformService`），公司侧服务改为读平台线路和套餐。网页新增平台「通话套餐」「电话线路」两页和公司详情的「通话服务」卡片，公司设置页改成「套餐和用量 / 可拨打的号码 / 成员坐席」三块。

**Tech Stack:** NestJS + class-validator、Prisma 7（driver adapter）、PostgreSQL RLS、Jest e2e（真实 PostgreSQL）、Next.js 16 + antd 6 + React Query、openapi-fetch 契约、Vitest。

**设计文档:** `docs/superpowers/specs/2026-11-27-platform-telephony-design.md`

## Global Constraints

- 推送、开 PR、合并之前都要先得到用户明确同意。本计划所有提交都只在本地分支 `claude/telephony`。
- 不改 Codex 的分支和工作树（`~/.codex/worktrees/*`），只读。不动用户主工作区，不动 `crm` 库，不碰生产环境。
- 演示数据不要删除；需要清理时先问用户。重建 `crm_telephony_review` 会删掉本地测试时建的电话数据，动手前先问用户（第 13 个任务）。
- 提交信息末尾写 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；PR 描述末尾写 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
- 凭据（企业 ID、密钥）只能用 `request_secret` 获取，绝不写进仓库、日志或聊天；聊天里出现过的快马 appkey / appSecret 不得复述、使用或保存。
- 测试号码必须由用户明确授权；真实线路只打一通。快马后台只能由用户本人登录。本计划不做真实外呼。
- 金额一律以「元」存：单价 `numeric(10,4)`，月售价和加量收费 `numeric(12,2)`；接口里金额用字符串，计算用 `Prisma.Decimal`。网页校验：金额 `/^\d{1,10}(\.\d{1,2})?$/`，单价 `/^\d{1,6}(\.\d{1,4})?$/`。
- 月份按公司时区取当月第一天，和 AI 用量一致。
- 公司侧所有接口不返回金额、进价和平台账号字段。
- 不可用原因只有四种，按这个顺序判断：`NOT_ENABLED`、`PLATFORM_NOT_READY`、`MINUTES_EXHAUSTED`、`MEMBER_NOT_CONFIGURED`。
- 每通按通话秒数除以 60 向上取整计分钟；只有「已接通」计费；同一通只计一次。
- 坐席账号 = `'c' + sha256(成员 ID) 的前 15 位十六进制`；模拟坐席号 = `MOCK-` + 坐席账号。
- 服务器总闸 `TELEPHONY_LIVE_ENABLED` 保留；快马线路在它为 `false` 时算「未就绪」，也不建真实坐席。
- 本地测试库：docker `crm-telephony-test-pg`（`127.0.0.1:55466`，库 `crm_telephony_test_1`）；e2e 一律用 `.local/telephony/run-e2e.sh <spec>` 跑（它会临时挪开根目录 `.env`）。演练库 `crm_telephony_review`，Web 3110，API 3111，Redis db 6。
- 回复用户用中文、说人话。

---

## 文件结构

**数据库**
- 改写：`packages/database/prisma/migrations/0066_tenant_telephony/migration.sql`：平台线路、套餐、公司开通、套餐历史、月用量、加量记录，以及改过的三张公司表；写入角色、RLS、触发器和函数。
- 修改：`packages/database/prisma/schema.prisma`：新增 6 个模型，改 3 个模型，`Tenant` 加关系。

**API（`apps/api/src/modules/integrations/telephony/`）**
- 修改 `telephony-provider.ts`：密钥保险箱改成平台级；新增签名、坐席查 / 建 / 改接口。
- 新建 `telephony-line.ts`：读平台线路、判断线路是否就绪、读公司用量。
- 新建 `telephony-seats.ts`：自动建坐席（只调快马，不碰数据库）。
- 新建 `telephony-platform.dto.ts`、`telephony-platform.service.ts`、`telephony-platform.controller.ts`：平台的线路、套餐、公司开通、加分钟、收支接口。
- 修改 `telephony.dto.ts`、`telephony.service.ts`、`telephony.controller.ts`：公司侧改读平台线路和套餐，回调地址只剩一个。
- 修改 `../integrations.module.ts`：注册新服务和控制器。
- 修改 `apps/api/src/modules/notifications/notifications.dto.ts`、`notifications.service.ts`：两种通话额度提醒。
- 测试：`telephony-provider.spec.ts`（扩充）、新建 `telephony-line.spec.ts`、`telephony-seats.spec.ts`；新建 `apps/api/test/helpers/telephony-fixture.ts`、`apps/api/test/platform-telephony.e2e-spec.ts`；修改 `apps/api/test/telephony.e2e-spec.ts`、`apps/api/package.json`。

**网页**
- 新建 `apps/web/src/features/platform/telephony/`：`platform-telephony-api.ts`、`line-settings.tsx`、`plans-page.tsx`、`report.tsx`、`company-telephony.tsx`、`platform-telephony.module.css`、`platform-telephony.test.tsx`。
- 新建路由：`apps/web/src/app/(platform)/platform/telephony-plans/page.tsx`、`apps/web/src/app/(platform)/platform/settings/telephony/page.tsx`。
- 新建：`apps/web/src/features/telephony/telephony-settings.test.tsx`。
- 修改：平台导航、面包屑、系统设置页、公司详情页；公司侧 `telephony-api.ts`、`telephony-settings.tsx`、`telephony.module.css`、`call-dialog.test.tsx`、工作区导航、`workspace-shell.tsx`、工作区 `layout.tsx`、设置概览、`settings/page.tsx`、`record-detail-page.tsx`、通知铃铛、审计文案。

**本地和文档**
- 修改（本地，不提交）：`.local/telephony/fake-kuaima.mjs`；新建演练脚本 `.local/telephony/pw/platform-rehearsal.mjs`。
- 修改：`docs/integrations/kuaima-telephony.md`、`docs/integrations/kuaima-vendor-questions.md`。

## 任务顺序

1. 数据库（0066 和 Prisma 模型）
2. 快马坐席接口和平台级密钥
3. 平台线路读取和自动建坐席
4. 公司侧服务改读平台线路和套餐
5. 平台接口和两套端到端测试
6. 通话额度提醒
7. 接口契约
8. 公司侧网页
9. 平台「电话线路」页
10. 平台「通话套餐」页和「收支」
11. 公司详情的「通话服务」卡片
12. 本地假快马和文档
13. 全量验证、本地演练和汇报

Task 1 到 Task 4 中间 API 类型检查不通过（Task 4 结束时恢复）；Task 7 到 Task 8 中间网页类型检查不通过（Task 8 结束时恢复）。

---

### Task 1: 数据库——改写 0066 和 Prisma 模型

**Files:**
- Rewrite: `packages/database/prisma/migrations/0066_tenant_telephony/migration.sql`
- Modify: `packages/database/prisma/schema.prisma`（`Tenant` 关系约第 218–220 行；电话三个模型约第 1555–1626 行）

**Interfaces:**
- Produces（后面所有任务都依赖这些名字）：
  - 表：`telephony_platform_settings`（单行，`id = true`）、`telephony_plans`、`tenant_telephony_configs`、`telephony_plan_history`、`telephony_tenant_months`、`telephony_minute_additions`；`telephony_settings` 只剩 `tenant_id, version, phone_fields, updated_at`；`telephony_member_bindings` 新增 `provider_username, seat_created_at, seat_error`；`telephony_calls` 新增 `month, billed_minutes, cost_per_minute`，`provider_bind_id` 全局唯一。
  - crm_app 可调用的函数：
    - `telephony_usage(t uuid) → (month date, plan_id uuid, plan_name text, seats int, monthly_minutes int, used_minutes int, extra_minutes int, seats_enabled int)`，平台管理员或本公司成员可调；
    - `telephony_line() → (mode text, company_id text, app_secret_encrypted text, callback_token_encrypted text)`；
    - `telephony_route_bind(b text) → uuid`；
    - `telephony_assign_plan(t uuid, p uuid, v int) → boolean`（版本不符返回 false；坐席超出抛 `23514`，消息 `TELEPHONY_SEATS_EXCEEDED`；套餐不可分配抛 `22023`）；
    - `telephony_add_minutes(t uuid, mo date, n int, amount numeric, memo text, k text) → boolean`（同键重复返回 false；同键内容不同或不是当月抛 `22023`）；
    - `telephony_plan_overflow(p uuid, new_seats int) → (tenant_id uuid, tenant_name text, seats_enabled int)`；
    - `telephony_report(mo date) → (tenant_id uuid, tenant_name text, plan_name text, monthly_price numeric, monthly_minutes int, used_minutes int, extra_minutes int, extra_price numeric, minute_cost numeric, seats_provisioned int)`；
    - `telephony_platform_seats() → int`。
  - 应用层锁的键 `${tenantId}:telephony` 与 SQL `telephony_lock_tenant(t)` 是同一把锁（`pg_advisory_xact_lock(hashtextextended(key, 0))`）。
  - Prisma 模型：`TelephonyPlatformSettings`、`TelephonyPlan`、`TenantTelephonyConfig`、`TelephonyPlanHistory`、`TelephonyTenantMonth`、`TelephonyMinuteAddition`。

- [ ] **Step 1: 改写迁移**

用下面的内容整体替换 `packages/database/prisma/migrations/0066_tenant_telephony/migration.sql`。文件末尾的 `renew_record_pool_follow_up` 和原文件一字不差。

```sql
-- Platform outbound calling (快马 callback). The platform holds one supplier
-- account for every company and resells minutes in plans, the way it sells AI
-- (0054). Secrets are AES-GCM envelopes sealed by the API keyring; the database
-- never sees plaintext. Billing, monthly usage and threshold notices are kept by
-- triggers owned by a non-login writer role, so the application cannot write
-- them directly.
BEGIN;

DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='crm_telephony_writer') THEN
  CREATE ROLE crm_telephony_writer NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE, CREATE ON SCHEMA public TO crm_telephony_writer;

CREATE TABLE telephony_platform_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 mode varchar(16) NOT NULL DEFAULT 'MOCK' CHECK (mode IN ('MOCK','KUAIMA')),
 company_id varchar(100) NOT NULL DEFAULT '',
 app_secret_encrypted text,
 callback_token_encrypted text,
 cost_per_minute numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_per_minute >= 0),
 seat_monthly_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (seat_monthly_cost >= 0),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO telephony_platform_settings DEFAULT VALUES;

CREATE TABLE telephony_plans (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
 name varchar(60) NOT NULL UNIQUE CHECK (btrim(name) <> ''),
 seats integer NOT NULL CHECK (seats BETWEEN 1 AND 10000),
 monthly_minutes integer NOT NULL CHECK (monthly_minutes BETWEEN 0 AND 10000000),
 monthly_price numeric(12,2) NOT NULL CHECK (monthly_price >= 0),
 assignable boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- No row means 未开通. Rows are written only by telephony_assign_plan.
CREATE TABLE tenant_telephony_configs (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 plan_id uuid REFERENCES telephony_plans(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX tenant_telephony_configs_plan_id_idx ON tenant_telephony_configs(plan_id);
-- Append-only. Revenue for a month uses the last row before that month ends.
CREATE TABLE telephony_plan_history (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 plan_id uuid,
 plan_name varchar(60),
 monthly_price numeric(12,2) NOT NULL DEFAULT 0,
 monthly_minutes integer NOT NULL DEFAULT 0,
 seats integer NOT NULL DEFAULT 0,
 effective_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX telephony_plan_history_tenant_id_effective_at_idx ON telephony_plan_history(tenant_id, effective_at DESC);
CREATE TABLE telephony_tenant_months (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 used_minutes integer NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
 extra_minutes integer NOT NULL DEFAULT 0 CHECK (extra_minutes >= 0),
 notified_80 boolean NOT NULL DEFAULT false,
 notified_100 boolean NOT NULL DEFAULT false,
 PRIMARY KEY (tenant_id, month)
);
CREATE TABLE telephony_minute_additions (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 key varchar(100) NOT NULL,
 month date NOT NULL CHECK (extract(day FROM month) = 1),
 minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1000000),
 price numeric(12,2) NOT NULL CHECK (price >= 0),
 note varchar(200) NOT NULL DEFAULT '',
 created_by uuid NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id, key)
);
CREATE INDEX telephony_minute_additions_tenant_id_month_idx ON telephony_minute_additions(tenant_id, month);

CREATE TABLE telephony_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 phone_fields jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phone_fields) = 'array'),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE telephony_member_bindings (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 member_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 enabled boolean NOT NULL DEFAULT false,
 -- Written by the system after the supplier created the seat; MOCK-… on the simulated line.
 seat_id varchar(100) NOT NULL DEFAULT '',
 provider_username varchar(64) NOT NULL DEFAULT '',
 seat_created_at timestamptz(3),
 seat_error varchar(200),
 phone varchar(20) NOT NULL DEFAULT '' CHECK (phone = '' OR phone ~ '^1[3-9][0-9]{9}$'),
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id,member_id),
 FOREIGN KEY (tenant_id,member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE telephony_calls (
 id uuid PRIMARY KEY DEFAULT crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
 actor_member_id uuid NOT NULL,
 request_id uuid NOT NULL,
 object_id uuid NOT NULL,
 object_code varchar(64) NOT NULL,
 record_id uuid NOT NULL,
 field_key varchar(64) NOT NULL,
 mode varchar(16) NOT NULL CHECK (mode IN ('MOCK','KUAIMA')),
 status varchar(32) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','ACCEPTED','UNKNOWN','CONNECTED','NOT_CONNECTED','ENDED','FAILED')),
 caller_phone varchar(20) NOT NULL CHECK (caller_phone ~ '^1[3-9][0-9]{9}$'),
 callee_phone varchar(20) NOT NULL CHECK (callee_phone ~ '^1[3-9][0-9]{9}$'),
 seat_id varchar(100) NOT NULL,
 provider_bind_id varchar(200),
 -- The supplier's short refusal text when it rejected the dial.
 failure_reason varchar(200),
 recording_url text,
 began_at timestamptz(3),
 ended_at timestamptz(3),
 duration_seconds integer CHECK (duration_seconds >= 0),
 activity_id uuid,
 -- Stamped by telephony_call_stamp: the company's month at dial time, the
 -- platform's cost per minute at dial time, and the minutes billed once connected.
 month date NOT NULL DEFAULT CURRENT_DATE,
 billed_minutes integer NOT NULL DEFAULT 0 CHECK (billed_minutes >= 0),
 cost_per_minute numeric(10,4) NOT NULL DEFAULT 0,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (tenant_id,actor_member_id) REFERENCES tenant_members(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (tenant_id,object_id,record_id) REFERENCES records(tenant_id,object_id,id) ON DELETE RESTRICT,
 -- An administrator may delete the machine CALL activity (0048); the call keeps its outcome.
 FOREIGN KEY (tenant_id,record_id,activity_id) REFERENCES record_activities(tenant_id,record_id,id) ON DELETE SET NULL (activity_id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE (tenant_id,actor_member_id,request_id),
 -- One supplier account for the whole platform: a supplier call ID names one call.
 UNIQUE (provider_bind_id)
);
-- UNKNOWN deliberately holds the gate until a verified callback resolves it.
CREATE UNIQUE INDEX telephony_calls_one_open_per_actor ON telephony_calls(tenant_id,actor_member_id)
 WHERE status IN ('REQUESTED','ACCEPTED','UNKNOWN');
CREATE INDEX telephony_calls_tenant_id_actor_member_id_created_at_idx ON telephony_calls(tenant_id,actor_member_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_record_id_created_at_idx ON telephony_calls(tenant_id,record_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_created_at_idx ON telephony_calls(tenant_id,created_at DESC);
CREATE INDEX telephony_calls_tenant_id_month_idx ON telephony_calls(tenant_id,month);

DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['telephony_platform_settings','telephony_plans','tenant_telephony_configs','telephony_plan_history','telephony_tenant_months','telephony_minute_additions','telephony_settings','telephony_member_bindings','telephony_calls'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY telephony_writer_access ON %I TO crm_telephony_writer USING(true) WITH CHECK(true)',n);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO crm_telephony_writer',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['telephony_settings','telephony_member_bindings','telephony_calls'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app',n);
  EXECUTE format('CREATE POLICY %I ON %I TO crm_app USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',n || '_tenant_access',n);
 END LOOP;
END $$;
GRANT SELECT, UPDATE ON telephony_platform_settings TO crm_app;
CREATE POLICY platform_line ON telephony_platform_settings TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform());
GRANT SELECT, INSERT, UPDATE, DELETE ON telephony_plans TO crm_app;
CREATE POLICY platform_plans ON telephony_plans TO crm_app USING(ai_is_platform()) WITH CHECK(ai_is_platform());
GRANT SELECT ON tenant_telephony_configs, telephony_plan_history, telephony_tenant_months, telephony_minute_additions TO crm_app;
CREATE POLICY config_read ON tenant_telephony_configs FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id));
CREATE POLICY month_read ON telephony_tenant_months FOR SELECT TO crm_app USING(ai_is_platform() OR ai_is_member(tenant_id));
CREATE POLICY history_read ON telephony_plan_history FOR SELECT TO crm_app USING(ai_is_platform());
CREATE POLICY additions_read ON telephony_minute_additions FOR SELECT TO crm_app USING(ai_is_platform());
CREATE POLICY telephony_platform_audit ON audit_logs FOR INSERT TO crm_app WITH CHECK(ai_is_platform() AND actor_id=nullif(current_setting('app.user_id',true),'')::uuid AND action IN ('telephony.plan_assigned','telephony.minutes_added'));

GRANT SELECT ON users, tenants, tenant_members TO crm_telephony_writer;
CREATE POLICY telephony_writer_tenants ON tenants FOR SELECT TO crm_telephony_writer USING(true);
CREATE POLICY telephony_writer_members ON tenant_members FOR SELECT TO crm_telephony_writer USING(true);
GRANT INSERT ON member_notifications TO crm_telephony_writer;
CREATE POLICY telephony_writer_thresholds ON member_notifications FOR INSERT TO crm_telephony_writer WITH CHECK(kind IN ('TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100'));
GRANT EXECUTE ON FUNCTION ai_is_platform(), ai_is_member(uuid,uuid,boolean) TO crm_telephony_writer;

ALTER TABLE member_notifications DROP CONSTRAINT member_notifications_kind_check, DROP CONSTRAINT member_notifications_goal_shape;
ALTER TABLE member_notifications ADD CONSTRAINT member_notifications_kind_check CHECK(kind IN (
 'CONTACT_DUE','FOLLOW_UP_DUE','TASK_OVERDUE','POOL_RECLAIMED','PROTECTION_REVIEW','WORK_GOAL_BEHIND','AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100')),
 ADD CONSTRAINT member_notifications_goal_shape CHECK (
 (kind='WORK_GOAL_BEHIND' AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NOT NULL AND goal_date IS NOT NULL AND details IS NOT NULL AND jsonb_typeof(details)='object')
 OR (kind IN ('AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
 OR (kind NOT IN ('WORK_GOAL_BEHIND','AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') AND object_id IS NOT NULL AND record_id IS NOT NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
);
CREATE OR REPLACE VIEW public.current_member_notifications WITH (security_invoker=true) AS
 SELECT n.id,n.tenant_id,n.recipient_member_id,n.object_id,n.record_id,n.follow_up_id,n.kind,n.event_key,n.due_at,n.created_at,n.created_xid,n.read_at,n.resolved_at,o.code AS object_code,o.name AS object_name,r.record_no,r.owner_member_id AS record_owner_member_id,n.goal_rule_id,n.goal_date,n.details
 FROM public.member_notifications n
 JOIN public.tenants t ON t.id=n.tenant_id AND t.status='ACTIVE'
 JOIN public.tenant_members m ON m.tenant_id=n.tenant_id AND m.id=n.recipient_member_id AND m.status='ACTIVE'
 JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
 LEFT JOIN public.object_definitions o ON o.tenant_id=n.tenant_id AND o.id=n.object_id
 LEFT JOIN public.records r ON r.tenant_id=n.tenant_id AND r.object_id=n.object_id AND r.id=n.record_id
 LEFT JOIN public.record_follow_ups f ON f.tenant_id=n.tenant_id AND f.record_id=n.record_id AND f.id=n.follow_up_id
 WHERE n.resolved_at IS NULL AND (
  n.kind IN ('WORK_GOAL_BEHIND','POOL_RECLAIMED','AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') OR (
   o.status='ACTIVE' AND o.deleted_at IS NULL AND r.deleted_at IS NULL AND (
    (n.kind IN ('CONTACT_DUE','FOLLOW_UP_DUE') AND o.pool_enabled AND o.pool_lifecycle_enabled
      AND NOT r.in_public_pool AND r.owner_member_id=n.recipient_member_id
      AND r.ownership_expires_at=n.due_at AND n.due_at>CURRENT_TIMESTAMP
      AND ((n.kind='CONTACT_DUE' AND r.pool_stage='PENDING_CONTACT' AND n.due_at<=CURRENT_TIMESTAMP+LEAST(interval '2 hours',o.pool_contact_ttl_hours*interval '1 hour'/4))
        OR (n.kind='FOLLOW_UP_DUE' AND r.pool_stage='FOLLOWING' AND n.due_at<=CURRENT_TIMESTAMP+LEAST(interval '24 hours',o.pool_follow_up_ttl_hours*interval '1 hour'/4))))
    OR (n.kind='TASK_OVERDUE' AND f.status='OPEN' AND f.assignee_member_id=n.recipient_member_id AND f.due_at=n.due_at AND f.due_at<=CURRENT_TIMESTAMP)
    OR (n.kind='PROTECTION_REVIEW' AND r.pool_stage='PROTECTED' AND r.protection_needs_review AND m.role='TENANT_ADMIN')
   )
  )
 );

-- Same lock as the API's `${tenantId}:telephony` advisory key.
CREATE FUNCTION telephony_lock_tenant(t uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT pg_advisory_xact_lock(hashtextextended(t::text||':telephony',0))
$$;
CREATE FUNCTION telephony_current_month(t uuid) RETURNS date LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT date_trunc('month', clock_timestamp() AT TIME ZONE timezone)::date FROM tenants WHERE id=t
$$;
CREATE FUNCTION telephony_seats_enabled(t uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT count(*)::int FROM telephony_member_bindings b
 JOIN tenant_members m ON m.tenant_id=b.tenant_id AND m.id=b.member_id
 WHERE b.tenant_id=t AND b.enabled AND m.status='ACTIVE'
$$;
CREATE FUNCTION telephony_usage(t uuid) RETURNS TABLE(month date, plan_id uuid, plan_name text, seats integer, monthly_minutes integer, used_minutes integer, extra_minutes integer, seats_enabled integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_column
BEGIN
 IF NOT (ai_is_platform() OR coalesce(ai_is_member(t),false)) THEN RAISE insufficient_privilege; END IF;
 RETURN QUERY
 SELECT mo.m, p.id, p.name::text, coalesce(p.seats,0), coalesce(p.monthly_minutes,0),
  coalesce(tm.used_minutes,0), coalesce(tm.extra_minutes,0), telephony_seats_enabled(t)
 FROM (SELECT telephony_current_month(t) AS m) mo
 LEFT JOIN tenant_telephony_configs c ON c.tenant_id=t
 LEFT JOIN telephony_plans p ON p.id=c.plan_id
 LEFT JOIN telephony_tenant_months tm ON tm.tenant_id=t AND tm.month=mo.m;
END $$;
-- Dialing needs the line in every company context; the envelopes stay sealed.
CREATE FUNCTION telephony_line() RETURNS TABLE(mode text, company_id text, app_secret_encrypted text, callback_token_encrypted text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT s.mode::text, s.company_id::text, s.app_secret_encrypted, s.callback_token_encrypted FROM telephony_platform_settings s WHERE s.id
$$;
-- One callback address for every company: the supplier call ID names the company.
CREATE FUNCTION telephony_route_bind(b text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT c.tenant_id FROM telephony_calls c WHERE c.provider_bind_id=b
$$;
CREATE FUNCTION telephony_record_plan(t uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 INSERT INTO telephony_plan_history(tenant_id,plan_id,plan_name,monthly_price,monthly_minutes,seats)
 SELECT t, p.id, p.name, coalesce(p.monthly_price,0), coalesce(p.monthly_minutes,0), coalesce(p.seats,0)
 FROM tenant_telephony_configs c LEFT JOIN telephony_plans p ON p.id=c.plan_id WHERE c.tenant_id=t
$$;
CREATE FUNCTION telephony_assign_plan(t uuid, p uuid, v integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cur tenant_telephony_configs%ROWTYPE; target telephony_plans%ROWTYPE;
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 PERFORM telephony_lock_tenant(t);
 IF NOT EXISTS (SELECT FROM tenants WHERE id=t) THEN RAISE invalid_parameter_value; END IF;
 SELECT * INTO cur FROM tenant_telephony_configs WHERE tenant_id=t;
 IF coalesce(cur.version,0)<>v THEN RETURN false; END IF;
 IF cur.plan_id IS NOT DISTINCT FROM p THEN RETURN true; END IF;
 IF p IS NOT NULL THEN
  SELECT * INTO target FROM telephony_plans WHERE id=p FOR SHARE;
  IF NOT FOUND OR NOT target.assignable THEN RAISE invalid_parameter_value; END IF;
  IF telephony_seats_enabled(t)>target.seats THEN
   RAISE EXCEPTION 'TELEPHONY_SEATS_EXCEEDED' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO tenant_telephony_configs AS c (tenant_id,plan_id) VALUES(t,p)
  ON CONFLICT (tenant_id) DO UPDATE SET plan_id=excluded.plan_id, version=c.version+1;
 PERFORM telephony_record_plan(t);
 RETURN true;
END $$;
CREATE FUNCTION telephony_add_minutes(t uuid, mo date, n integer, amount numeric, memo text, k text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old telephony_minute_additions%ROWTYPE;
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 PERFORM telephony_lock_tenant(t);
 SELECT * INTO old FROM telephony_minute_additions WHERE tenant_id=t AND key=k;
 IF FOUND THEN
  IF old.minutes<>n OR old.month<>mo OR old.price<>amount THEN RAISE invalid_parameter_value; END IF;
  RETURN false;
 END IF;
 IF mo IS DISTINCT FROM telephony_current_month(t) THEN RAISE invalid_parameter_value; END IF;
 INSERT INTO telephony_minute_additions(tenant_id,key,month,minutes,price,note,created_by)
  VALUES(t,k,mo,n,amount,coalesce(memo,''),nullif(current_setting('app.user_id',true),'')::uuid);
 INSERT INTO telephony_tenant_months(tenant_id,month) VALUES(t,mo) ON CONFLICT DO NOTHING;
 UPDATE telephony_tenant_months SET extra_minutes=extra_minutes+n WHERE tenant_id=t AND month=mo;
 RETURN true;
END $$;
CREATE FUNCTION telephony_plan_overflow(p uuid, new_seats integer) RETURNS TABLE(tenant_id uuid, tenant_name text, seats_enabled integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_column
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 RETURN QUERY
 SELECT c.tenant_id, tn.name::text, telephony_seats_enabled(c.tenant_id)
 FROM tenant_telephony_configs c JOIN tenants tn ON tn.id=c.tenant_id
 WHERE c.plan_id=p AND telephony_seats_enabled(c.tenant_id)>new_seats
 ORDER BY tn.name, c.tenant_id;
END $$;
CREATE FUNCTION telephony_report(mo date) RETURNS TABLE(tenant_id uuid, tenant_name text, plan_name text, monthly_price numeric, monthly_minutes integer, used_minutes integer, extra_minutes integer, extra_price numeric, minute_cost numeric, seats_provisioned integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_column
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 IF extract(day FROM mo)<>1 THEN RAISE invalid_parameter_value; END IF;
 RETURN QUERY
 WITH bounds AS (
  SELECT tn.id, tn.name, ((mo + interval '1 month')::timestamp AT TIME ZONE tn.timezone) AS ends FROM tenants tn
 ), plan AS (
  SELECT DISTINCT ON (h.tenant_id) h.tenant_id, h.plan_id, h.plan_name, h.monthly_price, h.monthly_minutes
  FROM telephony_plan_history h JOIN bounds b ON b.id=h.tenant_id
  WHERE h.effective_at < b.ends
  ORDER BY h.tenant_id, h.effective_at DESC, h.id DESC
 ), billed AS (
  SELECT c.tenant_id, sum(c.billed_minutes)::int AS minutes, sum(c.billed_minutes*c.cost_per_minute) AS cost
  FROM telephony_calls c WHERE c.month=mo GROUP BY c.tenant_id
 ), added AS (
  SELECT a.tenant_id, sum(a.minutes)::int AS minutes, sum(a.price) AS price
  FROM telephony_minute_additions a WHERE a.month=mo GROUP BY a.tenant_id
 ), provisioned AS (
  SELECT s.tenant_id, count(*)::int AS n FROM telephony_member_bindings s JOIN bounds b ON b.id=s.tenant_id
  WHERE s.seat_created_at < b.ends AND s.seat_id <> '' AND s.seat_id NOT LIKE 'MOCK-%' GROUP BY s.tenant_id
 )
 SELECT b.id, b.name::text, p.plan_name::text, coalesce(p.monthly_price,0)::numeric, coalesce(p.monthly_minutes,0),
  coalesce(bl.minutes,0), coalesce(ad.minutes,0), coalesce(ad.price,0)::numeric, coalesce(bl.cost,0)::numeric, coalesce(pv.n,0)
 FROM bounds b
 LEFT JOIN plan p ON p.tenant_id=b.id
 LEFT JOIN billed bl ON bl.tenant_id=b.id
 LEFT JOIN added ad ON ad.tenant_id=b.id
 LEFT JOIN provisioned pv ON pv.tenant_id=b.id
 WHERE p.plan_id IS NOT NULL OR bl.tenant_id IS NOT NULL OR ad.tenant_id IS NOT NULL OR pv.tenant_id IS NOT NULL
 ORDER BY b.name, b.id;
END $$;
CREATE FUNCTION telephony_platform_seats() RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT ai_is_platform() THEN RAISE insufficient_privilege; END IF;
 RETURN (SELECT count(*)::int FROM telephony_member_bindings WHERE seat_id<>'' AND seat_id NOT LIKE 'MOCK-%');
END $$;

-- The month, cost and billed minutes are the database's, never the caller's.
CREATE FUNCTION telephony_call_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.month := telephony_current_month(NEW.tenant_id);
  NEW.cost_per_minute := CASE WHEN NEW.mode='KUAIMA' THEN (SELECT s.cost_per_minute FROM telephony_platform_settings s WHERE s.id) ELSE 0 END;
  NEW.billed_minutes := 0;
 ELSE
  NEW.month := OLD.month;
  NEW.cost_per_minute := OLD.cost_per_minute;
  NEW.billed_minutes := OLD.billed_minutes;
 END IF;
 -- Billed once, on the first transition to CONNECTED; whole minutes rounded up.
 IF NEW.status='CONNECTED' AND (TG_OP='INSERT' OR OLD.status<>'CONNECTED') THEN
  NEW.billed_minutes := ceil(coalesce(NEW.duration_seconds,0)/60.0)::int;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER telephony_call_stamp BEFORE INSERT OR UPDATE ON telephony_calls FOR EACH ROW EXECUTE FUNCTION telephony_call_stamp();
CREATE FUNCTION telephony_call_meter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE delta integer := NEW.billed_minutes - CASE WHEN TG_OP='UPDATE' THEN OLD.billed_minutes ELSE 0 END;
BEGIN
 INSERT INTO telephony_tenant_months(tenant_id,month) VALUES(NEW.tenant_id,NEW.month) ON CONFLICT DO NOTHING;
 UPDATE telephony_tenant_months SET used_minutes=used_minutes+delta WHERE tenant_id=NEW.tenant_id AND month=NEW.month;
 RETURN NULL;
END $$;
CREATE TRIGGER telephony_call_meter_insert AFTER INSERT ON telephony_calls FOR EACH ROW WHEN (NEW.billed_minutes > 0) EXECUTE FUNCTION telephony_call_meter();
CREATE TRIGGER telephony_call_meter_update AFTER UPDATE ON telephony_calls FOR EACH ROW WHEN (NEW.billed_minutes > OLD.billed_minutes) EXECUTE FUNCTION telephony_call_meter();
CREATE FUNCTION telephony_check_thresholds() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cap numeric; pct integer;
BEGIN
 -- A flag, once set for the month, stays set: added minutes never re-notify.
 NEW.notified_80 := NEW.notified_80 OR OLD.notified_80;
 NEW.notified_100 := NEW.notified_100 OR OLD.notified_100;
 SELECT p.monthly_minutes::numeric+NEW.extra_minutes INTO cap FROM tenant_telephony_configs c JOIN telephony_plans p ON p.id=c.plan_id WHERE c.tenant_id=NEW.tenant_id;
 IF cap IS NULL OR cap=0 THEN RETURN NEW; END IF;
 FOREACH pct IN ARRAY ARRAY[80,100] LOOP
  IF NEW.used_minutes::numeric*100>=cap*pct AND NOT (CASE pct WHEN 80 THEN NEW.notified_80 ELSE NEW.notified_100 END) THEN
   INSERT INTO member_notifications(tenant_id,recipient_member_id,kind,event_key)
   SELECT NEW.tenant_id,m.id,'TELEPHONY_MINUTES_'||pct,NEW.month::text FROM tenant_members m JOIN users u ON u.id=m.user_id
    WHERE m.tenant_id=NEW.tenant_id AND m.role='TENANT_ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'
    ON CONFLICT DO NOTHING;
   IF pct=80 THEN NEW.notified_80:=true; ELSE NEW.notified_100:=true; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
-- Not on INSERT: a new month row carries no usage yet.
CREATE TRIGGER telephony_month_threshold BEFORE UPDATE OF used_minutes,extra_minutes ON telephony_tenant_months FOR EACH ROW EXECUTE FUNCTION telephony_check_thresholds();
-- A plan edit applies to every company on it at once, is recorded for revenue,
-- and may not take seats away from a company that already uses them.
CREATE FUNCTION telephony_plan_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t uuid;
BEGIN
 FOR t IN SELECT c.tenant_id FROM tenant_telephony_configs c WHERE c.plan_id=NEW.id ORDER BY c.tenant_id LOOP
  PERFORM telephony_lock_tenant(t);
  IF NEW.seats<OLD.seats AND telephony_seats_enabled(t)>NEW.seats THEN
   RAISE EXCEPTION 'TELEPHONY_SEATS_EXCEEDED' USING ERRCODE='23514';
  END IF;
  IF (NEW.name,NEW.seats,NEW.monthly_minutes,NEW.monthly_price) IS DISTINCT FROM (OLD.name,OLD.seats,OLD.monthly_minutes,OLD.monthly_price) THEN
   PERFORM telephony_record_plan(t);
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER telephony_plan_changed AFTER UPDATE ON telephony_plans FOR EACH ROW EXECUTE FUNCTION telephony_plan_changed();

-- Explicit allowlist: internal helpers and triggers are never callable directly.
DO $$ DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS signature, p.proname FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
  'telephony_lock_tenant','telephony_current_month','telephony_seats_enabled','telephony_usage','telephony_line','telephony_route_bind',
  'telephony_record_plan','telephony_assign_plan','telephony_add_minutes','telephony_plan_overflow','telephony_report','telephony_platform_seats',
  'telephony_call_stamp','telephony_call_meter','telephony_check_thresholds','telephony_plan_changed') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,crm_app',fn.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO crm_telephony_writer',fn.signature);
  IF fn.proname IN ('telephony_usage','telephony_line','telephony_route_bind','telephony_assign_plan','telephony_add_minutes','telephony_plan_overflow','telephony_report','telephony_platform_seats') THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO crm_app',fn.signature);
  END IF;
 END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM crm_telephony_writer;

-- Same body as 0030 plus the first check: a machine call outcome counts as a
-- call, never as a human follow-up, so it does not renew the pool deadline.
CREATE OR REPLACE FUNCTION public.renew_record_pool_follow_up() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE target record; config record; actor record; event_time timestamptz;
BEGIN
 IF EXISTS (SELECT 1 FROM public.telephony_calls c WHERE c.tenant_id=NEW.tenant_id AND c.record_id=NEW.record_id AND c.actor_member_id=NEW.actor_member_id AND c.activity_id=NEW.id AND c.mode='KUAIMA' AND c.status IN ('CONNECTED','NOT_CONNECTED')) THEN RETURN NEW; END IF;
 IF NEW.activity_type NOT IN ('NOTE','CALL','MEETING','MESSAGE') OR length(btrim(COALESCE(NEW.content,'')))=0 THEN RETURN NEW; END IF;
 SELECT * INTO target FROM public.records WHERE id=NEW.record_id AND tenant_id=NEW.tenant_id AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO config FROM public.object_definitions WHERE id=target.object_id AND tenant_id=target.tenant_id;
 IF NOT config.pool_enabled OR NOT config.pool_lifecycle_enabled OR target.pool_stage IS DISTINCT FROM 'FOLLOWING' THEN RETURN NEW; END IF;
 SELECT m.role INTO actor FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id
 WHERE m.id=NEW.actor_member_id AND m.tenant_id=NEW.tenant_id AND m.status='ACTIVE' AND u.status='ACTIVE' AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid;
 IF NOT FOUND OR (actor.role<>'TENANT_ADMIN' AND NEW.actor_member_id IS DISTINCT FROM target.owner_member_id) THEN RETURN NEW; END IF;
 event_time := clock_timestamp();
 IF target.ownership_expires_at IS NULL OR target.ownership_expires_at <= event_time THEN
   RAISE EXCEPTION 'Record follow-up deadline expired' USING ERRCODE='P0001';
 END IF;
 UPDATE public.records SET pool_last_follow_up_at=event_time, ownership_expires_at=event_time+config.pool_follow_up_ttl_hours*interval '1 hour', version=version+1,updated_at=event_time WHERE id=target.id;
 RETURN NEW;
END;
$function$;

COMMIT;
```

- [ ] **Step 2: 改 Prisma 模型**

在 `model Tenant` 里，把三行电话关系（`telephonySettings`、`telephonyBindings`、`telephonyCalls`）换成：

```prisma
  telephonySettings TelephonySettings?
  telephonyBindings TelephonyMemberBinding[]
  telephonyCalls TelephonyCall[]
  telephonyConfig TenantTelephonyConfig?
  telephonyPlanHistory TelephonyPlanHistory[]
  telephonyMonths TelephonyTenantMonth[]
  telephonyMinuteAdditions TelephonyMinuteAddition[]
```

把从注释 `// Migration 0066 also enforces …` 到 `model TelephonyCall` 结束的整段换成：

```prisma
// Migration 0066 also enforces one open call per actor, a deferred activity FK
// (SET NULL on activity delete), RLS on every table, and triggers that stamp
// month / cost / billed minutes on calls and keep monthly usage and notices.
model TelephonyPlatformSettings {
  id                     Boolean  @id @default(true)
  version                Int      @default(1)
  mode                   String   @default("MOCK") @db.VarChar(16)
  companyId              String   @default("") @map("company_id") @db.VarChar(100)
  appSecretEncrypted     String?  @map("app_secret_encrypted")
  callbackTokenEncrypted String?  @map("callback_token_encrypted")
  costPerMinute          Decimal  @default(0) @map("cost_per_minute") @db.Decimal(10, 4)
  seatMonthlyCost        Decimal  @default(0) @map("seat_monthly_cost") @db.Decimal(12, 2)
  updatedAt              DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("telephony_platform_settings")
}

model TelephonyPlan {
  id             String                  @id @default(dbgenerated("crm_uuid_v7()")) @db.Uuid
  name           String                  @unique @db.VarChar(60)
  seats          Int
  monthlyMinutes Int                     @map("monthly_minutes")
  monthlyPrice   Decimal                 @map("monthly_price") @db.Decimal(12, 2)
  assignable     Boolean                 @default(true)
  version        Int                     @default(1)
  createdAt      DateTime                @default(now()) @map("created_at") @db.Timestamptz(3)
  configs        TenantTelephonyConfig[]

  @@map("telephony_plans")
}

model TenantTelephonyConfig {
  tenantId String         @id @map("tenant_id") @db.Uuid
  planId   String?        @map("plan_id") @db.Uuid
  version  Int            @default(1)
  tenant   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  plan     TelephonyPlan? @relation(fields: [planId], references: [id], onDelete: Restrict, onUpdate: NoAction)

  @@index([planId])
  @@map("tenant_telephony_configs")
}

model TelephonyPlanHistory {
  id             String   @id @default(dbgenerated("crm_uuid_v7()")) @db.Uuid
  tenantId       String   @map("tenant_id") @db.Uuid
  planId         String?  @map("plan_id") @db.Uuid
  planName       String?  @map("plan_name") @db.VarChar(60)
  monthlyPrice   Decimal  @default(0) @map("monthly_price") @db.Decimal(12, 2)
  monthlyMinutes Int      @default(0) @map("monthly_minutes")
  seats          Int      @default(0)
  effectiveAt    DateTime @default(dbgenerated("clock_timestamp()")) @map("effective_at") @db.Timestamptz(3)
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@index([tenantId, effectiveAt(sort: Desc)])
  @@map("telephony_plan_history")
}

model TelephonyTenantMonth {
  tenantId     String   @map("tenant_id") @db.Uuid
  month        DateTime @db.Date
  usedMinutes  Int      @default(0) @map("used_minutes")
  extraMinutes Int      @default(0) @map("extra_minutes")
  notified80   Boolean  @default(false) @map("notified_80")
  notified100  Boolean  @default(false) @map("notified_100")
  tenant       Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@id([tenantId, month])
  @@map("telephony_tenant_months")
}

model TelephonyMinuteAddition {
  tenantId  String   @map("tenant_id") @db.Uuid
  key       String   @db.VarChar(100)
  month     DateTime @db.Date
  minutes   Int
  price     Decimal  @db.Decimal(12, 2)
  note      String   @default("") @db.VarChar(200)
  createdBy String   @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@id([tenantId, key])
  @@index([tenantId, month])
  @@map("telephony_minute_additions")
}

model TelephonySettings {
  tenantId    String   @id @map("tenant_id") @db.Uuid
  version     Int      @default(1)
  phoneFields Json     @default("[]") @map("phone_fields") @db.JsonB
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: NoAction)

  @@map("telephony_settings")
}

model TelephonyMemberBinding {
  tenantId         String       @map("tenant_id") @db.Uuid
  memberId         String       @map("member_id") @db.Uuid
  version          Int          @default(1)
  enabled          Boolean      @default(false)
  seatId           String       @default("") @map("seat_id") @db.VarChar(100)
  providerUsername String       @default("") @map("provider_username") @db.VarChar(64)
  seatCreatedAt    DateTime?    @map("seat_created_at") @db.Timestamptz(3)
  seatError        String?      @map("seat_error") @db.VarChar(200)
  phone            String       @default("") @db.VarChar(20)
  updatedAt        DateTime     @updatedAt @map("updated_at") @db.Timestamptz(3)
  tenant           Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  member           TenantMember @relation(fields: [tenantId, memberId], references: [tenantId, id], onDelete: Cascade, onUpdate: NoAction)

  @@id([tenantId, memberId])
  @@map("telephony_member_bindings")
}

model TelephonyCall {
  id              String          @id @default(dbgenerated("crm_uuid_v7()")) @db.Uuid
  tenantId        String          @map("tenant_id") @db.Uuid
  actorMemberId   String          @map("actor_member_id") @db.Uuid
  requestId       String          @map("request_id") @db.Uuid
  objectId        String          @map("object_id") @db.Uuid
  objectCode      String          @map("object_code") @db.VarChar(64)
  recordId        String          @map("record_id") @db.Uuid
  fieldKey        String          @map("field_key") @db.VarChar(64)
  mode            String          @db.VarChar(16)
  status          String          @default("REQUESTED") @db.VarChar(32)
  callerPhone     String          @map("caller_phone") @db.VarChar(20)
  calleePhone     String          @map("callee_phone") @db.VarChar(20)
  seatId          String          @map("seat_id") @db.VarChar(100)
  providerBindId  String?         @unique @map("provider_bind_id") @db.VarChar(200)
  failureReason   String?         @map("failure_reason") @db.VarChar(200)
  recordingUrl    String?         @map("recording_url")
  beganAt         DateTime?       @map("began_at") @db.Timestamptz(3)
  endedAt         DateTime?       @map("ended_at") @db.Timestamptz(3)
  durationSeconds Int?            @map("duration_seconds")
  activityId      String?         @map("activity_id") @db.Uuid
  month           DateTime        @default(dbgenerated("CURRENT_DATE")) @db.Date
  billedMinutes   Int             @default(0) @map("billed_minutes")
  costPerMinute   Decimal         @default(0) @map("cost_per_minute") @db.Decimal(10, 4)
  createdAt       DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt       DateTime        @updatedAt @map("updated_at") @db.Timestamptz(3)
  tenant          Tenant          @relation(fields: [tenantId], references: [id], onDelete: Restrict, onUpdate: NoAction)
  actor           TenantMember    @relation(fields: [tenantId, actorMemberId], references: [tenantId, id], onDelete: Restrict, onUpdate: NoAction)
  record          Record          @relation(fields: [tenantId, objectId, recordId], references: [tenantId, objectId, id], onDelete: Restrict, onUpdate: NoAction)
  activity        RecordActivity? @relation(fields: [tenantId, recordId, activityId], references: [tenantId, recordId, id], onDelete: NoAction, onUpdate: NoAction) // DB: ON DELETE SET NULL (activity_id)

  @@unique([tenantId, actorMemberId, requestId])
  @@index([tenantId, actorMemberId, createdAt(sort: Desc)])
  @@index([tenantId, recordId, createdAt(sort: Desc)])
  @@index([tenantId, createdAt(sort: Desc)])
  @@index([tenantId, month])
  @@map("telephony_calls")
}
```

- [ ] **Step 3: 校验模型并生成客户端**

Run: `pnpm --filter @crm/database exec prisma validate && pnpm --filter @crm/database prisma:generate`
Expected: `The schema at prisma/schema.prisma is valid`，随后 `Generated Prisma Client`。

- [ ] **Step 4: 重建测试库并跑迁移**

```bash
docker exec crm-telephony-test-pg psql -U crm -d postgres \
  -c 'DROP DATABASE IF EXISTS crm_telephony_test_1 WITH (FORCE)' \
  -c 'CREATE DATABASE crm_telephony_test_1'
DATABASE_ADMIN_URL='postgresql://crm:crm@127.0.0.1:55466/crm_telephony_test_1?schema=public' \
  pnpm --filter @crm/database exec prisma migrate deploy
```

Expected: 最后一行 `All migrations have been successfully applied.`，其中包括 `0066_tenant_telephony`。

- [ ] **Step 5: 检查函数归属、授权和触发器**

```bash
docker exec crm-telephony-test-pg psql -U crm -d crm_telephony_test_1 -At -c "
SELECT p.proname, pg_get_userbyid(p.proowner), has_function_privilege('crm_app', p.oid, 'EXECUTE')
FROM pg_proc p WHERE p.proname LIKE 'telephony\_%' ORDER BY 1;" -c "
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'telephony\_%' ORDER BY 1;" -c "
SELECT count(*) FROM telephony_platform_settings;"
```

Expected：16 个函数的归属都是 `crm_telephony_writer`；`crm_app` 只对这 8 个是 `t`：`telephony_add_minutes`、`telephony_assign_plan`、`telephony_line`、`telephony_plan_overflow`、`telephony_platform_seats`、`telephony_report`、`telephony_route_bind`、`telephony_usage`，其余是 `f`。触发器 5 个：`telephony_call_meter_insert`、`telephony_call_meter_update`、`telephony_call_stamp`、`telephony_month_threshold`、`telephony_plan_changed`。平台线路表 1 行。

- [ ] **Step 6: 提交**

```bash
git add packages/database/prisma/migrations/0066_tenant_telephony/migration.sql packages/database/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
电话外呼数据库改为平台线路：套餐、开通、月用量、加量和计费触发器

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

此时 API 还引用旧字段，`pnpm --filter @crm/api typecheck` 会失败，到 Task 4 结束时恢复。Task 2、3 只跑各自的单元测试。

---

### Task 2: 快马坐席接口和平台级密钥

**Files:**
- Modify: `apps/api/src/modules/integrations/telephony/telephony-provider.ts`（整体替换）
- Test: `apps/api/src/modules/integrations/telephony/telephony-provider.spec.ts`

**Interfaces:**
- Produces:
  - `class TelephonyVault { seal(kind: TelephonySecretKind, value: string): string; open(kind: TelephonySecretKind, stored: string): string }`，附加数据 `telephony` + `platform:${kind}`。
  - `signature(companyId: string, appSecret: string, ts: number): string`
  - `type KuaimaAccount = { companyId: string; appSecret: string; origin: string }`
  - `type KuaimaSeat = { id: string; username: string; mobile: string }`
  - `class KuaimaSeatError extends Error { readonly reason: string }`
  - `KuaimaProvider.findSeat(account, username, transport?, ts?): Promise<KuaimaSeat | null>`
  - `KuaimaProvider.createSeat(account, seat: { username; nickname; mobile; password }, transport?, ts?): Promise<void>`
  - `KuaimaProvider.updateSeat(account, seatId, changes: { mobile; nickname }, transport?, ts?): Promise<void>`
  - `KuaimaProvider.dial(...)` 签名不变。

- [ ] **Step 1: 写失败的测试**

在 `telephony-provider.spec.ts` 里：

1. 第一行 import 改为：

```ts
import { createHash } from 'node:crypto';
import {
  normalizePhone,
  KuaimaProvider,
  KuaimaSeatError,
  safeRecordingUrl,
  signature,
  TelephonyVault,
} from './telephony-provider';
```

2. 把测试 `seals secrets with the keyring, bound to the tenant and the secret kind` 整个换成下面这个；如果 `const tenant = …` 之后再没有用处，一并删掉：

```ts
  it('seals platform secrets with the keyring, bound to the secret kind', () => {
    const vault = new TelephonyVault(() => keyring('k1', 'a'));
    const sealed = vault.seal('appSecret', 'secret');
    expect(sealed).not.toContain('secret');
    expect(vault.seal('appSecret', 'secret')).not.toBe(sealed);
    expect(vault.open('appSecret', sealed)).toBe('secret');
    // Another column or another master key cannot open it.
    expect(() => vault.open('callbackToken', sealed)).toThrow();
    expect(() =>
      new TelephonyVault(() => keyring('k2', 'b')).open('appSecret', sealed),
    ).toThrow();
  });
```

3. 在文件末尾追加：

```ts
describe('kuaima seats', () => {
  const account = {
    companyId: '131',
    appSecret: 'app-secret',
    origin: 'https://kuaima.example',
  };
  const seat = {
    username: 'cabc',
    nickname: '孙悦',
    mobile: '13900000000',
    password: 'pw-123456',
  };
  const provider = new KuaimaProvider();
  const reply = (payload: unknown, status = 200) =>
    jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status })),
    );
  const sent = (transport: jest.Mock, call = 0) => {
    const [url, init] = transport.mock.calls[call] as unknown as [
      string,
      RequestInit,
    ];
    return { url, form: Object.fromEntries(init.body as URLSearchParams) };
  };

  it('signs enterprise requests the way the supplier documents', async () => {
    expect(signature('123', 'abc123def456', 1678901234)).toBe(
      createHash('md5')
        .update('123abc123def4561678901234')
        .digest('hex')
        .toUpperCase(),
    );
    const transport = reply({ code: 1, msg: 'success', data: { list: [] } });
    await provider.findSeat(account, 'cabc', transport, 1678901234);
    expect(sent(transport)).toEqual({
      url: 'https://kuaima.example/api/company/getSeatsList',
      form: {
        company_id: '131',
        ts: '1678901234',
        sign: signature('131', 'app-secret', 1678901234),
        page: '1',
        limit: '10',
        username: 'cabc',
      },
    });
  });

  it('finds only the exact seat account and reads its numeric ID', async () => {
    const transport = reply({
      code: 1,
      data: {
        list: [
          { id: 140, username: 'cabc1', mobile: '13800000001' },
          { id: 135, username: 'cabc', mobile: '13800000002' },
        ],
      },
    });
    expect(await provider.findSeat(account, 'cabc', transport)).toEqual({
      id: '135',
      username: 'cabc',
      mobile: '13800000002',
    });
    expect(
      await provider.findSeat(account, 'none', reply({ code: 1, data: {} })),
    ).toBeNull();
  });

  it('creates a seat as a one-item JSON list and never echoes its password', async () => {
    const transport = reply({ code: 1, msg: '添加成功', data: null });
    await provider.createSeat(account, seat, transport);
    const { url, form } = sent(transport);
    expect(url).toBe('https://kuaima.example/api/company/createSeats');
    expect(JSON.parse(form.seats)).toEqual([seat]);
    await expect(
      provider.createSeat(account, seat, reply({ code: 0, msg: '手机号已存在' })),
    ).rejects.toMatchObject({ reason: '手机号已存在' });
    await expect(
      provider.createSeat(
        account,
        seat,
        reply({ code: 0, msg: '密码 pw-123456 不合规' }),
      ),
    ).rejects.toMatchObject({ reason: '快马拒绝了请求' });
  });

  it('updates a seat mobile by seat ID', async () => {
    const transport = reply({ code: 1, msg: '更新成功！', data: null });
    await provider.updateSeat(
      account,
      '135',
      { mobile: '13900000001', nickname: '孙悦' },
      transport,
    );
    expect(sent(transport).url).toBe(
      'https://kuaima.example/api/company/updateSeats',
    );
    expect(sent(transport).form).toMatchObject({
      seats_id: '135',
      mobile: '13900000001',
      nickname: '孙悦',
    });
  });

  it('turns an unreachable or broken supplier into a readable seat error', async () => {
    const down = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
    await expect(provider.findSeat(account, 'cabc', down)).rejects.toEqual(
      expect.any(KuaimaSeatError),
    );
    await expect(provider.findSeat(account, 'cabc', down)).rejects.toMatchObject(
      { reason: '快马接口无响应，请稍后重试' },
    );
    await expect(
      provider.findSeat(account, 'cabc', reply({}, 502)),
    ).rejects.toMatchObject({ reason: '快马接口返回 HTTP 502' });
    await expect(
      provider.findSeat(account, 'cabc', reply({ code: 0, msg: 'app-secret 错误' })),
    ).rejects.toMatchObject({ reason: '快马拒绝了请求' });
  });
});
```

- [ ] **Step 2: 确认测试失败**

Run: `cd apps/api && npx jest src/modules/integrations/telephony/telephony-provider.spec.ts`
Expected: FAIL，类型错误 `Module '"./telephony-provider"' has no exported member 'KuaimaSeatError'`（以及 `signature`）。

- [ ] **Step 3: 实现**

把 `telephony-provider.ts` 整体替换为：

```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception';
import { ModelKeyring, type Envelope } from '../../ai/governance/model-secrets';

export const KUAIMA_ORIGIN = 'https://www.kuaimatongxun.com';
const KUAIMA_DIAL_PATH = '/api/call/callBind';
const SEAT_LIST_PATH = '/api/company/getSeatsList';
const SEAT_CREATE_PATH = '/api/company/createSeats';
const SEAT_UPDATE_PATH = '/api/company/updateSeats';

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:\+86)?1[3-9]\d{9}$/.test(value))
    throw new ApiException('FIELD_INVALID', 400, {
      message: '仅支持中国大陆手机号码或 +86 前缀。',
    });
  return value.replace(/^\+86/, '');
}

export type TelephonySecretKind = 'appSecret' | 'callbackToken';

/**
 * The platform's supplier secrets are sealed with the API's master keyring (the
 * same one that protects model keys), bound by AAD to their column so an
 * envelope cannot be replayed into the other one.
 */
export class TelephonyVault {
  private cached?: { raw: string | undefined; keyring: ModelKeyring };
  constructor(private readonly raw: () => string | undefined) {}

  private ring(): ModelKeyring {
    try {
      const raw = this.raw();
      if (!this.cached || this.cached.raw !== raw)
        this.cached = { raw, keyring: new ModelKeyring(raw) };
      return this.cached.keyring;
    } catch {
      throw new ApiException('VALIDATION_FAILED', 503, {
        message: '电话密钥不可用：服务器主密钥环未配置。',
      });
    }
  }
  seal(kind: TelephonySecretKind, value: string): string {
    return JSON.stringify(this.ring().seal('telephony', `platform:${kind}`, value));
  }
  open(kind: TelephonySecretKind, stored: string): string {
    const ring = this.ring();
    try {
      return ring.open(
        'telephony',
        `platform:${kind}`,
        JSON.parse(stored) as Envelope,
      );
    } catch {
      throw new ApiException('VALIDATION_FAILED', 503, {
        message: '电话密钥不可用，请平台管理员重新填写。',
      });
    }
  }
}

export function safeRecordingUrl(value: string): string {
  try {
    const url = new URL(value);
    // Recording URLs are links only, never fetched by this service. Reject local/IP/credential URLs.
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !url.hostname.includes('.') ||
      /^[\d.]+$/.test(url.hostname) ||
      /[:\]]/.test(url.hostname) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)
    )
      throw new Error('invalid');
    return url.toString();
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '录音地址必须是公开 HTTPS 地址。',
    });
  }
}

export type DialResult = {
  status: 'ACCEPTED' | 'UNKNOWN' | 'FAILED';
  providerBindId: string | null;
  /** The supplier's own short refusal text (never the full response). */
  failureReason: string | null;
};
export type KuaimaAccount = {
  companyId: string;
  appSecret: string;
  origin: string;
};
export type KuaimaSeat = { id: string; username: string; mobile: string };
/** The supplier refused or could not be reached; `reason` is safe to show. */
export class KuaimaSeatError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'KuaimaSeatError';
  }
}

/** 接口签名：MD5(company_id + app_secret + ts)，转大写。 */
export function signature(companyId: string, appSecret: string, ts: number) {
  return createHash('md5')
    .update(`${companyId}${appSecret}${ts}`)
    .digest('hex')
    .toUpperCase();
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function codeOf(payload: Record<string, unknown>): number {
  const code = payload.code;
  return typeof code === 'number'
    ? code
    : typeof code === 'string' && /^-?\d+$/.test(code)
      ? Number(code)
      : NaN;
}
function refusal(message: unknown, secrets: string[]): string | null {
  if (typeof message !== 'string') return null;
  const text = [...message]
    .map((char) => (char < ' ' || char === '\u007f' ? ' ' : char))
    .join('')
    .trim();
  if (!text || secrets.some((secret) => secret && text.includes(secret)))
    return null;
  return text.slice(0, 120);
}
const now = () => Math.floor(Date.now() / 1000);
const UNKNOWN: DialResult = {
  status: 'UNKNOWN',
  providerBindId: null,
  failureReason: null,
};

@Injectable()
export class KuaimaProvider {
  /**
   * 企业拨打&绑定-快捷模式. `code=1` with `data.bind_id` only means the supplier
   * accepted the request; it says nothing about whether anyone answered.
   */
  async dial(
    input: {
      companyId: string;
      appSecret: string;
      caller: string;
      callee: string;
    },
    transport: typeof fetch = fetch,
    ts = now(),
    origin = KUAIMA_ORIGIN,
  ): Promise<DialResult> {
    const body = new URLSearchParams({
      company_id: input.companyId,
      ts: String(ts),
      sign: signature(input.companyId, input.appSecret, ts),
      // The parameter table says api_type, the example says platform; both
      // name the same switch and the supplier ignores unknown form fields.
      api_type: 'companyapi',
      platform: 'companyapi',
      type: '2',
      caller: input.caller,
      callee: input.callee,
    });
    try {
      const response = await transport(`${origin}${KUAIMA_DIAL_PATH}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (!response.ok) return UNKNOWN;
      const payload = objectOf(await response.json());
      if (payload && 'code' in payload) {
        const code = codeOf(payload);
        const bindId = objectOf(payload.data)?.bind_id;
        if (
          code === 1 &&
          typeof bindId === 'string' &&
          bindId.trim() &&
          bindId.length <= 200
        )
          return {
            status: 'ACCEPTED',
            providerBindId: bindId,
            failureReason: null,
          };
        if (Number.isFinite(code) && code !== 1)
          return {
            status: 'FAILED',
            providerBindId: null,
            failureReason: refusal(payload.msg ?? payload.info, [
              input.appSecret,
            ]),
          };
      }
    } catch {
      /* Ambiguous submission: never retry a dial or expose provider payloads. */
    }
    return UNKNOWN;
  }

  /** 获取坐席列表, filtered to the exact account name. */
  async findSeat(
    account: KuaimaAccount,
    username: string,
    transport: typeof fetch = fetch,
    ts = now(),
  ): Promise<KuaimaSeat | null> {
    const payload = await this.enterprise(
      account,
      SEAT_LIST_PATH,
      { page: '1', limit: '10', username },
      [],
      transport,
      ts,
    );
    const list = objectOf(payload.data)?.list;
    for (const entry of Array.isArray(list) ? (list as unknown[]) : []) {
      const seat = objectOf(entry);
      if (!seat || seat.username !== username) continue;
      const id = seat.id;
      if (
        (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
        (typeof id === 'string' && /^\d{1,20}$/.test(id))
      )
        return {
          id: String(id),
          username,
          mobile: typeof seat.mobile === 'string' ? seat.mobile : '',
        };
    }
    return null;
  }

  /** 添加坐席. The password is random and never stored or echoed. */
  async createSeat(
    account: KuaimaAccount,
    seat: { username: string; nickname: string; mobile: string; password: string },
    transport: typeof fetch = fetch,
    ts = now(),
  ): Promise<void> {
    await this.enterprise(
      account,
      SEAT_CREATE_PATH,
      { seats: JSON.stringify([seat]) },
      [seat.password],
      transport,
      ts,
    );
  }

  /** 更新坐席: the answering mobile and display name. */
  async updateSeat(
    account: KuaimaAccount,
    seatId: string,
    changes: { mobile: string; nickname: string },
    transport: typeof fetch = fetch,
    ts = now(),
  ): Promise<void> {
    await this.enterprise(
      account,
      SEAT_UPDATE_PATH,
      { seats_id: seatId, ...changes },
      [],
      transport,
      ts,
    );
  }

  /** One signed enterprise call; anything but `code=1` is a KuaimaSeatError. */
  private async enterprise(
    account: KuaimaAccount,
    path: string,
    fields: Record<string, string>,
    secrets: string[],
    transport: typeof fetch,
    ts: number,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      company_id: account.companyId,
      ts: String(ts),
      sign: signature(account.companyId, account.appSecret, ts),
      ...fields,
    });
    let response: Response;
    try {
      response = await transport(`${account.origin}${path}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      throw new KuaimaSeatError('快马接口无响应，请稍后重试');
    }
    if (!response.ok)
      throw new KuaimaSeatError(`快马接口返回 HTTP ${response.status}`);
    const payload = objectOf(await response.json().catch(() => null));
    if (!payload) throw new KuaimaSeatError('快马接口返回了无法识别的内容');
    if (codeOf(payload) !== 1)
      throw new KuaimaSeatError(
        refusal(payload.msg ?? payload.info, [account.appSecret, ...secrets]) ??
          '快马拒绝了请求',
      );
    return payload;
  }
}
```

- [ ] **Step 4: 确认测试通过**

Run: `cd apps/api && npx jest src/modules/integrations/telephony/telephony-provider.spec.ts`
Expected: PASS，原有拨号测试和新增 6 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/integrations/telephony/telephony-provider.ts apps/api/src/modules/integrations/telephony/telephony-provider.spec.ts
git commit -m "$(cat <<'EOF'
快马坐席接口：查、建、改坐席，密钥改为平台级

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 平台线路读取和自动建坐席

**Files:**
- Create: `apps/api/src/modules/integrations/telephony/telephony-line.ts`
- Create: `apps/api/src/modules/integrations/telephony/telephony-seats.ts`
- Test: `apps/api/src/modules/integrations/telephony/telephony-line.spec.ts`
- Test: `apps/api/src/modules/integrations/telephony/telephony-seats.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `telephony_line()`、`telephony_usage(t)`；Task 2 的 `TelephonyVault`、`KuaimaProvider`、`KuaimaSeatError`、`KuaimaAccount`。
- Produces:
  - `type LineMode = 'MOCK' | 'KUAIMA'`
  - `type LineRow = { mode: LineMode; companyId: string; appSecretEncrypted: string | null; callbackTokenEncrypted: string | null }`
  - `type Usage = { month: string; planId: string | null; planName: string | null; seats: number; monthlyMinutes: number; usedMinutes: number; extraMinutes: number; seatsEnabled: number }`（`month` 形如 `2026-11-01`）
  - `readUsage(tx: Prisma.TransactionClient, tenantId: string): Promise<Usage>`（公司不存在时 404 `TENANT_NOT_FOUND`）
  - `allowance(usage: Usage): number` = 套餐分钟 + 本月加量
  - `@Injectable() class TelephonyLine { vault; production(); liveEnabled(); kuaimaOrigin(); callbackEndpoint(); read(tx): Promise<LineRow>; problems(line): string[]; account(line): KuaimaAccount }`
  - `seatUsername(memberId: string): string`、`seatUsable(seatId: string, mode: LineMode): boolean`
  - `type Seat = { seatId: string; username: string }`
  - `@Injectable() class TelephonySeats { ensure(line: LineRow, current: { seatId: string; username: string; phone: string } | null, member: { id: string; name: string }, phone: string): Promise<Seat> }`

- [ ] **Step 1: 写失败的测试**

`telephony-line.spec.ts`：

```ts
import type { ConfigService } from '@nestjs/config';
import { TelephonyLine, type LineRow } from './telephony-line';

const keyring = (byte: number) =>
  JSON.stringify({
    activeKeyId: 'k',
    keys: { k: Buffer.alloc(32, byte).toString('base64') },
  });
function lineWith(env: Record<string, string>) {
  const values: Record<string, string> = { AI_MODEL_KEYRING: keyring(3), ...env };
  return new TelephonyLine({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService);
}
const empty: LineRow = {
  mode: 'KUAIMA',
  companyId: '',
  appSecretEncrypted: null,
  callbackTokenEncrypted: null,
};

describe('platform telephony line', () => {
  it('lists every missing piece of the supplier line', () => {
    expect(lineWith({}).problems(empty)).toEqual([
      '企业 ID 未填写',
      '企业密钥未填写',
      '回调地址未生成',
      '服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）',
    ]);
  });
  it('is ready once account, callback and server switch are in place', () => {
    const line = lineWith({ TELEPHONY_LIVE_ENABLED: 'true' });
    const row: LineRow = {
      mode: 'KUAIMA',
      companyId: '131',
      appSecretEncrypted: line.vault.seal('appSecret', 's'),
      callbackTokenEncrypted: line.vault.seal('callbackToken', 't'),
    };
    expect(line.problems(row)).toEqual([]);
    expect(line.account(row)).toEqual({
      companyId: '131',
      appSecret: 's',
      origin: 'https://www.kuaimatongxun.com',
    });
    expect(
      lineWith({
        TELEPHONY_LIVE_ENABLED: 'true',
        AI_MODEL_KEYRING: keyring(9),
      }).problems(row),
    ).toEqual(['密钥无法解开，请重新填写企业密钥并重新生成回调地址']);
  });
  it('allows the simulated line outside production only', () => {
    const mock: LineRow = { ...empty, mode: 'MOCK' };
    expect(lineWith({}).problems(mock)).toEqual([]);
    expect(lineWith({ NODE_ENV: 'production' }).problems(mock)).toEqual([
      '正式环境不能用模拟线路',
    ]);
  });
  it('uses a loopback supplier stand-in only outside production', () => {
    const local = 'http://127.0.0.1:3199';
    expect(lineWith({ TELEPHONY_KUAIMA_ORIGIN: local }).kuaimaOrigin()).toBe(local);
    expect(
      lineWith({ TELEPHONY_KUAIMA_ORIGIN: 'http://evil.example' }).kuaimaOrigin(),
    ).toBe('https://www.kuaimatongxun.com');
    expect(
      lineWith({ NODE_ENV: 'production', TELEPHONY_KUAIMA_ORIGIN: local }).kuaimaOrigin(),
    ).toBe('https://www.kuaimatongxun.com');
    expect(
      lineWith({ API_ORIGIN: 'https://api.example.com/' }).callbackEndpoint(),
    ).toBe('https://api.example.com/api/v1/telephony/hooks');
  });
});
```

`telephony-seats.spec.ts`：

```ts
import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { TelephonyLine, type LineRow } from './telephony-line';
import { KuaimaProvider, KuaimaSeatError } from './telephony-provider';
import { seatUsable, seatUsername, TelephonySeats } from './telephony-seats';

const member = { id: '11111111-1111-4111-8111-111111111111', name: '孙悦' };
const username =
  'c' + createHash('sha256').update(member.id).digest('hex').slice(0, 15);

function setup() {
  const values: Record<string, string> = {
    AI_MODEL_KEYRING: JSON.stringify({
      activeKeyId: 'k',
      keys: { k: Buffer.alloc(32, 5).toString('base64') },
    }),
    TELEPHONY_LIVE_ENABLED: 'true',
  };
  const line = new TelephonyLine({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService);
  const provider = new KuaimaProvider();
  const kuaima: LineRow = {
    mode: 'KUAIMA',
    companyId: '131',
    appSecretEncrypted: line.vault.seal('appSecret', 's'),
    callbackTokenEncrypted: line.vault.seal('callbackToken', 't'),
  };
  return {
    seats: new TelephonySeats(line, provider),
    kuaima,
    find: jest.spyOn(provider, 'findSeat').mockResolvedValue(null),
    create: jest.spyOn(provider, 'createSeat').mockResolvedValue(undefined),
    update: jest.spyOn(provider, 'updateSeat').mockResolvedValue(undefined),
  };
}

describe('automatic seats', () => {
  it('names a member seat account the same way every time', () => {
    expect(seatUsername(member.id)).toBe(username);
    expect(username).toHaveLength(16);
    expect(seatUsable(`MOCK-${username}`, 'MOCK')).toBe(true);
    expect(seatUsable(`MOCK-${username}`, 'KUAIMA')).toBe(false);
    expect(seatUsable('', 'MOCK')).toBe(false);
    expect(seatUsable('135', 'KUAIMA')).toBe(true);
  });
  it('gives a simulated seat on the simulated line without calling the supplier', async () => {
    const { seats, kuaima, find, create, update } = setup();
    expect(
      await seats.ensure({ ...kuaima, mode: 'MOCK' }, null, member, '13900000000'),
    ).toEqual({ seatId: `MOCK-${username}`, username });
    for (const spy of [find, create, update]) expect(spy).not.toHaveBeenCalled();
  });
  it('creates a seat with a random password and reads its ID back', async () => {
    const { seats, kuaima, find, create } = setup();
    find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: '135', username, mobile: '13900000000' });
    expect(await seats.ensure(kuaima, null, member, '13900000000')).toEqual({
      seatId: '135',
      username,
    });
    const [account, seat] = create.mock.calls[0];
    expect(account).toEqual({
      companyId: '131',
      appSecret: 's',
      origin: 'https://www.kuaimatongxun.com',
    });
    expect(seat).toMatchObject({ username, nickname: '孙悦', mobile: '13900000000' });
    expect(seat.password).toMatch(/^[\w-]{16}$/);
  });
  it('adopts a seat that was created but never saved, fixing its mobile', async () => {
    const { seats, kuaima, find, create, update } = setup();
    find.mockResolvedValueOnce({ id: '140', username, mobile: '13800000000' });
    expect(
      await seats.ensure(
        kuaima,
        { seatId: `MOCK-${username}`, username, phone: '13900000000' },
        member,
        '13900000000',
      ),
    ).toEqual({ seatId: '140', username });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.anything(), '140', {
      mobile: '13900000000',
      nickname: '孙悦',
    });
  });
  it('only updates the mobile of a seat it already has', async () => {
    const { seats, kuaima, find, update } = setup();
    const current = { seatId: '140', username, phone: '13800000000' };
    await seats.ensure(kuaima, current, member, '13900000000');
    await seats.ensure(kuaima, { ...current, phone: '13900000000' }, member, '13900000000');
    expect(find).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.anything(), '140', {
      mobile: '13900000000',
      nickname: '孙悦',
    });
  });
  it('reports a seat the supplier accepted but cannot find', async () => {
    const { seats, kuaima } = setup();
    await expect(
      seats.ensure(kuaima, null, member, '13900000000'),
    ).rejects.toBeInstanceOf(KuaimaSeatError);
  });
});
```

- [ ] **Step 2: 确认测试失败**

Run: `cd apps/api && npx jest src/modules/integrations/telephony/telephony-line.spec.ts src/modules/integrations/telephony/telephony-seats.spec.ts`
Expected: FAIL，`Cannot find module './telephony-line'`。

- [ ] **Step 3: 实现 `telephony-line.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import {
  KUAIMA_ORIGIN,
  TelephonyVault,
  type KuaimaAccount,
} from './telephony-provider';

export type LineMode = 'MOCK' | 'KUAIMA';
export type LineRow = {
  mode: LineMode;
  companyId: string;
  appSecretEncrypted: string | null;
  callbackTokenEncrypted: string | null;
};
export type Usage = {
  /** First day of the company's current month, `YYYY-MM-DD`. */
  month: string;
  planId: string | null;
  planName: string | null;
  seats: number;
  monthlyMinutes: number;
  usedMinutes: number;
  extraMinutes: number;
  seatsEnabled: number;
};

/** The company's plan and this month's usage; platform admins and members only. */
export async function readUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<Usage> {
  const [row] = await tx.$queryRaw<
    Array<{
      month: string | null;
      plan_id: string | null;
      plan_name: string | null;
      seats: number;
      monthly_minutes: number;
      used_minutes: number;
      extra_minutes: number;
      seats_enabled: number;
    }>
  >`SELECT to_char(u.month, 'YYYY-MM-DD') AS month, u.plan_id::text AS plan_id, u.plan_name, u.seats, u.monthly_minutes, u.used_minutes, u.extra_minutes, u.seats_enabled FROM telephony_usage(${tenantId}::uuid) u`;
  if (!row?.month) throw new ApiException('TENANT_NOT_FOUND', 404);
  return {
    month: row.month,
    planId: row.plan_id,
    planName: row.plan_name,
    seats: row.seats,
    monthlyMinutes: row.monthly_minutes,
    usedMinutes: row.used_minutes,
    extraMinutes: row.extra_minutes,
    seatsEnabled: row.seats_enabled,
  };
}

export const allowance = (usage: Usage) =>
  usage.monthlyMinutes + usage.extraMinutes;

/**
 * The platform's one supplier line. Every company dials through it; which
 * piece is missing is shown only on the platform's line page.
 */
@Injectable()
export class TelephonyLine {
  readonly vault: TelephonyVault;
  constructor(private readonly config: ConfigService) {
    this.vault = new TelephonyVault(() =>
      this.config.get<string>('AI_MODEL_KEYRING'),
    );
  }

  production() {
    return this.config.get('NODE_ENV') === 'production';
  }
  liveEnabled() {
    return this.config.get<string>('TELEPHONY_LIVE_ENABLED', 'false') === 'true';
  }
  /**
   * The supplier origin is fixed. Outside production a loopback fake supplier
   * may stand in for it, so the whole live path can be rehearsed locally.
   */
  kuaimaOrigin() {
    const override = this.config.get<string>('TELEPHONY_KUAIMA_ORIGIN', '');
    if (!override || this.production()) return KUAIMA_ORIGIN;
    const url = new URL(override);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return KUAIMA_ORIGIN;
    return url.origin;
  }
  callbackEndpoint() {
    const origin = this.config
      .get<string>('API_ORIGIN', 'http://localhost:3001')
      .replace(/\/+$/, '');
    return `${origin}/api/v1/telephony/hooks`;
  }

  async read(tx: Prisma.TransactionClient): Promise<LineRow> {
    const [row] = await tx.$queryRaw<
      Array<{
        mode: LineMode;
        company_id: string;
        app_secret_encrypted: string | null;
        callback_token_encrypted: string | null;
      }>
    >`SELECT mode, company_id, app_secret_encrypted, callback_token_encrypted FROM telephony_line()`;
    return {
      mode: row?.mode ?? 'MOCK',
      companyId: row?.company_id ?? '',
      appSecretEncrypted: row?.app_secret_encrypted ?? null,
      callbackTokenEncrypted: row?.callback_token_encrypted ?? null,
    };
  }

  /** Empty when the line can dial; otherwise what the platform must fix. */
  problems(line: LineRow): string[] {
    if (line.mode === 'MOCK')
      return this.production() ? ['正式环境不能用模拟线路'] : [];
    const problems: string[] = [];
    if (!line.companyId) problems.push('企业 ID 未填写');
    if (!line.appSecretEncrypted) problems.push('企业密钥未填写');
    if (!line.callbackTokenEncrypted) problems.push('回调地址未生成');
    if (!this.liveEnabled())
      problems.push('服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）');
    if (line.appSecretEncrypted && line.callbackTokenEncrypted)
      try {
        this.vault.open('appSecret', line.appSecretEncrypted);
        this.vault.open('callbackToken', line.callbackTokenEncrypted);
      } catch {
        problems.push('密钥无法解开，请重新填写企业密钥并重新生成回调地址');
      }
    return problems;
  }

  /** The supplier account; only call when `problems(line)` is empty. */
  account(line: LineRow): KuaimaAccount {
    return {
      companyId: line.companyId,
      appSecret: this.vault.open('appSecret', line.appSecretEncrypted ?? ''),
      origin: this.kuaimaOrigin(),
    };
  }
}
```

- [ ] **Step 4: 实现 `telephony-seats.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TelephonyLine, type LineMode, type LineRow } from './telephony-line';
import { KuaimaProvider, KuaimaSeatError } from './telephony-provider';

/** A member's supplier account: fixed, so a retry finds a half-saved seat. */
export function seatUsername(memberId: string) {
  return 'c' + createHash('sha256').update(memberId).digest('hex').slice(0, 15);
}
/** A simulated seat does not exist at the supplier. */
export function seatUsable(seatId: string, mode: LineMode) {
  return Boolean(seatId) && (mode === 'MOCK' || !seatId.startsWith('MOCK-'));
}
export type Seat = { seatId: string; username: string };

@Injectable()
export class TelephonySeats {
  constructor(
    private readonly line: TelephonyLine,
    private readonly provider: KuaimaProvider,
  ) {}

  /**
   * Makes sure the member has a seat that answers on `phone`. Calls the
   * supplier only; the caller saves the result. Throws KuaimaSeatError.
   */
  async ensure(
    line: LineRow,
    current: { seatId: string; username: string; phone: string } | null,
    member: { id: string; name: string },
    phone: string,
  ): Promise<Seat> {
    const username = seatUsername(member.id);
    if (line.mode === 'MOCK') return { seatId: `MOCK-${username}`, username };
    const account = this.line.account(line);
    const changes = { mobile: phone, nickname: member.name };
    if (current && seatUsable(current.seatId, 'KUAIMA')) {
      if (current.phone !== phone)
        await this.provider.updateSeat(account, current.seatId, changes);
      return { seatId: current.seatId, username: current.username || username };
    }
    let seat = await this.provider.findSeat(account, username);
    if (seat) {
      if (seat.mobile !== phone)
        await this.provider.updateSeat(account, seat.id, changes);
    } else {
      await this.provider.createSeat(account, {
        username,
        ...changes,
        password: randomBytes(12).toString('base64url'),
      });
      seat = await this.provider.findSeat(account, username);
      if (!seat)
        throw new KuaimaSeatError('快马已受理建坐席，但查不到这个坐席，请稍后重试');
    }
    return { seatId: seat.id, username };
  }
}
```

- [ ] **Step 5: 确认测试通过**

Run: `cd apps/api && npx jest src/modules/integrations/telephony/telephony-line.spec.ts src/modules/integrations/telephony/telephony-seats.spec.ts`
Expected: PASS（4 + 6 个测试）。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/modules/integrations/telephony/telephony-line.ts apps/api/src/modules/integrations/telephony/telephony-seats.ts apps/api/src/modules/integrations/telephony/telephony-line.spec.ts apps/api/src/modules/integrations/telephony/telephony-seats.spec.ts
git commit -m "$(cat <<'EOF'
电话外呼：读取平台线路、判断是否就绪、自动建坐席

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 公司侧服务改为读平台线路和套餐

这一步完成后 API 能通过类型检查。公司侧的 e2e 依赖平台接口来开通公司，所以和平台接口一起在 Task 5 里跑。

**Files:**
- Modify: `apps/api/src/modules/integrations/telephony/telephony.dto.ts`
- Modify: `apps/api/src/modules/integrations/telephony/telephony.service.ts`
- Modify: `apps/api/src/modules/integrations/telephony/telephony.controller.ts`
- Modify: `apps/api/src/modules/integrations/integrations.module.ts`

**Interfaces:**
- Consumes: Task 3 的 `TelephonyLine`、`TelephonySeats`、`readUsage`、`allowance`、`seatUsable`、`Seat`、`LineMode`、`Usage`；Task 2 的 `KuaimaSeatError`。
- Produces（网页和 e2e 依赖）：
  - `GET workspaces/:tenantCode/telephony/settings` → `{ version, phoneFields, plan: { name, seats, monthlyMinutes } | null, usage: { month, usedMinutes, extraMinutes, allowance, seatsEnabled }, lineReady }`
  - `PATCH …/settings` 只收 `{ version, phoneFields }`；未开通返回 403，`fieldErrors.telephony = ['NOT_ENABLED']`。
  - `GET …/members` → `{ members: Array<{ memberId, displayName, status, version, enabled, phone, seatStatus: 'NONE' | 'READY' | 'FAILED', seatError: string | null }> }`
  - `PATCH …/members/:memberId` 只收 `{ version, enabled, phone }`。坐席满 409 `fieldErrors.telephony = ['TELEPHONY_SEATS_FULL']`；快马失败 400 `message = '快马：原因'`、`fieldErrors.seat = ['TELEPHONY_SEAT_FAILED']`；线路未就绪 503 `fieldErrors.telephony = ['PLATFORM_NOT_READY']`。
  - `GET …/runtime` 新增 `hasHistory: boolean`；`reason` 只会是 `NOT_ENABLED | PLATFORM_NOT_READY | MINUTES_EXHAUSTED | MEMBER_NOT_CONFIGURED | null`；`mode` 是平台线路的模式。
  - 不可用时拨号返回 503，`fieldErrors.telephony = [reason]`。
  - 回调地址只有 `POST /api/v1/telephony/hooks`（`?token=` 或 `Authorization: Bearer`）。去掉 `POST …/settings/callback-token`。

- [ ] **Step 1: 改 DTO**

在 `telephony.dto.ts` 里：

1. `CALL_STATUSES` 下面加：

```ts
export const TELEPHONY_REASONS = [
  'NOT_ENABLED',
  'PLATFORM_NOT_READY',
  'MINUTES_EXHAUSTED',
  'MEMBER_NOT_CONFIGURED',
] as const;
export type TelephonyReason = (typeof TELEPHONY_REASONS)[number];
export const SEAT_STATUSES = ['NONE', 'READY', 'FAILED'] as const;
```

2. 把 `UpdateTelephonySettingsDto`、`TelephonySettingsResponseDto`、`TelephonyCallbackTokenResponseDto`、`UpdateTelephonyBindingDto`、`TelephonyBindingResponseDto` 五个类换成：

```ts
export class UpdateTelephonySettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty({ type: [TelephonyPhoneFieldsDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TelephonyPhoneFieldsDto)
  phoneFields!: TelephonyPhoneFieldsDto[];
}
export class TelephonyPlanSummaryDto {
  @ApiProperty() name!: string;
  @ApiProperty() seats!: number;
  @ApiProperty() monthlyMinutes!: number;
}
export class TelephonyUsageDto {
  /** First day of the company's month, YYYY-MM-DD. */
  @ApiProperty() month!: string;
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() extraMinutes!: number;
  /** Plan minutes plus this month's added minutes. */
  @ApiProperty() allowance!: number;
  @ApiProperty() seatsEnabled!: number;
}
/** What a company administrator sees: never money or the platform account. */
export class TelephonySettingsResponseDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: [TelephonyPhoneFieldsDto] })
  phoneFields!: TelephonyPhoneFieldsDto[];
  @ApiProperty({ type: TelephonyPlanSummaryDto, nullable: true })
  plan!: TelephonyPlanSummaryDto | null;
  @ApiProperty({ type: TelephonyUsageDto }) usage!: TelephonyUsageDto;
  @ApiProperty() lineReady!: boolean;
}
export class UpdateTelephonyBindingDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
}
export class TelephonyBindingResponseDto {
  @ApiProperty() memberId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: SEAT_STATUSES }) seatStatus!: 'NONE' | 'READY' | 'FAILED';
  /** The supplier's reason when creating or updating the seat failed. */
  @ApiProperty({ type: String, nullable: true }) seatError!: string | null;
}
```

3. `TelephonyRuntimeResponseDto` 改为：

```ts
export class TelephonyRuntimeResponseDto {
  /** The company has a plan. */
  @ApiProperty() enabled!: boolean;
  /** The company has calls on record, so the call log stays reachable. */
  @ApiProperty() hasHistory!: boolean;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() available!: boolean;
  @ApiProperty({ enum: TELEPHONY_REASONS, nullable: true })
  reason!: TelephonyReason | null;
  @ApiProperty({ type: String, nullable: true }) callerPhone!: string | null;
  @ApiProperty() liveEnabled!: boolean;
  /** The member's call that has not finished yet, if any. */
  @ApiProperty({ type: String, nullable: true }) openCallId!: string | null;
  @ApiProperty({ type: [TelephonyRuntimeFieldDto] })
  fields!: TelephonyRuntimeFieldDto[];
}
```

如果 `IsDefined`、`IsObject`、`ValidateNested` 等 import 因此变成未使用，按 lint 提示删掉。

- [ ] **Step 2: 改服务的开头部分**

`telephony.service.ts` 第 1–446 行（从 import 到 `runtime()` 结束）替换为：

```ts
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { AuditService } from '../../audit/audit.service';
import { PublishedObjectService } from '../../objects/published-object.service';
import {
  RecordsService,
  RECORDS_REPOSITORY,
  type RecordResponse,
} from '../../records/records.service';
import type { RecordsRepository } from '../../records/records.repository';
import {
  requireVisibleRecord,
  projectRecord,
} from '../../records/record-command';
import { lockMembers } from '../../records/record-ownership-locks';
import {
  allowance,
  readUsage,
  TelephonyLine,
  type LineMode,
  type LineRow,
  type Usage,
} from './telephony-line';
import {
  KuaimaProvider,
  KuaimaSeatError,
  normalizePhone,
  safeRecordingUrl,
} from './telephony-provider';
import { seatUsable, TelephonySeats, type Seat } from './telephony-seats';
import type {
  CreateTelephonyCallDto,
  TelephonyBindingResponseDto,
  TelephonyCallQueryDto,
  TelephonyCallResponseDto,
  TelephonyHookDto,
  TelephonyPhoneFieldsDto,
  TelephonyReason,
  TelephonyRuntimeQueryDto,
  TelephonySettingsResponseDto,
  UpdateTelephonyBindingDto,
  UpdateTelephonySettingsDto,
} from './telephony.dto';

type TelephonyCall = Prisma.TelephonyCallGetPayload<Record<string, never>>;
type TelephonySettings = Prisma.TelephonySettingsGetPayload<
  Record<string, never>
>;
type TelephonyBinding = Prisma.TelephonyMemberBindingGetPayload<
  Record<string, never>
>;

const OPEN = ['REQUESTED', 'ACCEPTED', 'UNKNOWN'];
const OUTCOMES = ['CONNECTED', 'NOT_CONNECTED'];
/** An open call may be closed by hand only after the supplier had time to answer. */
const CLOSE_AFTER_MS = 60_000;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const REASON_TEXT: Record<TelephonyReason, string> = {
  NOT_ENABLED: '公司未开通电话外呼',
  PLATFORM_NOT_READY: '通话线路暂不可用，请联系管理员',
  MINUTES_EXHAUSTED: '本月通话分钟已用完，请联系管理员',
  MEMBER_NOT_CONFIGURED: '你还没有外呼坐席，请联系管理员',
};

function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}
function fieldsOf(
  settings: TelephonySettings | null,
): TelephonyPhoneFieldsDto[] {
  return (settings?.phoneFields ?? []) as unknown as TelephonyPhoneFieldsDto[];
}
function unavailable(reason: TelephonyReason): never {
  throw new ApiException('VALIDATION_FAILED', 503, {
    message: `电话外呼不可用：${REASON_TEXT[reason]}`,
    fieldErrors: { telephony: [reason] },
  });
}
function notEnabled(): never {
  throw new ApiException('WORKSPACE_FORBIDDEN', 403, {
    message: '公司未开通电话外呼，请联系平台管理员。',
    fieldErrors: { telephony: ['NOT_ENABLED'] },
  });
}
function seatsFull(seats: number): never {
  throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
    message: `坐席已满：套餐含 ${seats} 个坐席，已全部开出。如需更多坐席，请联系平台管理员。`,
    fieldErrors: { telephony: ['TELEPHONY_SEATS_FULL'] },
  });
}
function duration(seconds: number | null) {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  return `，通话 ${minutes ? `${minutes} 分 ` : ''}${seconds % 60} 秒`;
}

@Injectable()
export class TelephonyService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly objects: PublishedObjectService,
    private readonly records: RecordsService,
    private readonly audit: AuditService,
    private readonly provider: KuaimaProvider,
    private readonly line: TelephonyLine,
    private readonly seats: TelephonySeats,
    @Inject(RECORDS_REPOSITORY) private readonly repository: RecordsRepository,
  ) {}

  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  private async publicSettings(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<TelephonySettingsResponseDto> {
    const settings = await tx.telephonySettings.findUnique({
      where: { tenantId },
    });
    const usage = await readUsage(tx, tenantId);
    const line = await this.line.read(tx);
    return {
      version: settings?.version ?? 0,
      phoneFields: fieldsOf(settings),
      plan: usage.planId
        ? {
            name: usage.planName ?? '',
            seats: usage.seats,
            monthlyMinutes: usage.monthlyMinutes,
          }
        : null,
      usage: {
        month: usage.month,
        usedMinutes: usage.usedMinutes,
        extraMinutes: usage.extraMinutes,
        allowance: allowance(usage),
        seatsEnabled: usage.seatsEnabled,
      },
      lineReady: this.line.problems(line).length === 0,
    };
  }
  private bindingView(
    member: { id: string; displayName: string; status: string },
    binding: TelephonyBinding | null,
    mode: LineMode,
  ): TelephonyBindingResponseDto {
    return {
      memberId: member.id,
      displayName: member.displayName,
      status: member.status,
      version: binding?.version ?? 0,
      enabled: binding?.enabled ?? false,
      phone: binding?.phone ?? '',
      seatStatus: binding?.seatError
        ? 'FAILED'
        : binding && seatUsable(binding.seatId, mode)
          ? 'READY'
          : 'NONE',
      seatError: binding?.seatError ?? null,
    };
  }

  settings(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, (tx) =>
      this.publicSettings(tx, context.tenantId),
    );
  }

  async updateSettings(
    context: TenantContext,
    input: UpdateTelephonySettingsDto,
  ) {
    admin(context);
    if (
      new Set(input.phoneFields.map((entry) => entry.objectCode)).size !==
      input.phoneFields.length
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    for (const entry of input.phoneFields) {
      const { schema } = await this.objects.resolveRuntimeSchema(
        context,
        entry.objectCode,
      );
      if (
        entry.fieldKeys.some(
          (key) =>
            !schema.fields.some(
              (field) =>
                field.fieldKey === key &&
                ['PHONE', 'TEXT'].includes(field.type),
            ),
        )
      )
        throw new ApiException('FIELD_INVALID', 400);
    }
    return this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony-settings`);
      if (!(await readUsage(tx, context.tenantId)).planId) notEnabled();
      const current = await tx.telephonySettings.findUnique({
        where: { tenantId: context.tenantId },
      });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const data = {
        version: input.version + 1,
        phoneFields: input.phoneFields
          .filter((entry) => entry.fieldKeys.length)
          .map(({ objectCode, fieldKeys }) => ({
            objectCode,
            fieldKeys,
          })) as unknown as Prisma.InputJsonValue,
      };
      const saved = await tx.telephonySettings.upsert({
        where: { tenantId: context.tenantId },
        create: { tenantId: context.tenantId, ...data },
        update: data,
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'telephony.settings_updated',
        resourceType: 'telephony_settings',
        resourceId: context.tenantId,
        requestId: randomUUID(),
        after: { version: saved.version },
      });
      return this.publicSettings(tx, context.tenantId);
    });
  }

  members(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, async (tx) => {
      const [members, bindings] = await Promise.all([
        tx.tenantMember.findMany({
          where: { tenantId: context.tenantId },
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.telephonyMemberBinding.findMany({
          where: { tenantId: context.tenantId },
        }),
      ]);
      const { mode } = await this.line.read(tx);
      return {
        members: members.map((member) =>
          this.bindingView(
            {
              id: member.id,
              displayName: member.displayName ?? member.user.displayName,
              status: member.status,
            },
            bindings.find((entry) => entry.memberId === member.id) ?? null,
            mode,
          ),
        ),
      };
    });
  }

  /**
   * Turns calling on or off for a member. Turning it on makes sure the member
   * has a supplier seat: check, then call the supplier outside any
   * transaction, then save under the company lock with a fresh seat count.
   */
  async updateMember(
    context: TenantContext,
    memberId: string,
    input: UpdateTelephonyBindingDto,
  ) {
    admin(context);
    const phone = input.phone ? normalizePhone(input.phone) : '';
    if (input.enabled && !phone)
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '开启外呼前请填写接听手机。',
      });
    const where = {
      tenantId_memberId: { tenantId: context.tenantId, memberId },
    };
    const before = await this.runner.withTenant(context, async (tx) => {
      const member = await tx.tenantMember.findFirst({
        where: { tenantId: context.tenantId, id: memberId },
        include: { user: { select: { displayName: true } } },
      });
      if (!member) throw new ApiException('OWNER_INVALID', 400);
      const current = await tx.telephonyMemberBinding.findUnique({ where });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const usage = await readUsage(tx, context.tenantId);
      if (input.enabled) {
        if (!usage.planId) notEnabled();
        if (!current?.enabled && usage.seatsEnabled >= usage.seats)
          seatsFull(usage.seats);
      }
      return { member, current, line: await this.line.read(tx) };
    });
    const displayName =
      before.member.displayName ?? before.member.user.displayName;
    let seat: Seat | null = null;
    if (input.enabled) {
      if (this.line.problems(before.line).length)
        unavailable('PLATFORM_NOT_READY');
      try {
        seat = await this.seats.ensure(
          before.line,
          before.current
            ? {
                seatId: before.current.seatId,
                username: before.current.providerUsername,
                phone: before.current.phone,
              }
            : null,
          { id: memberId, name: displayName },
          phone,
        );
      } catch (error) {
        if (!(error instanceof KuaimaSeatError)) throw error;
        const seatError = error.reason.slice(0, 200);
        await this.runner.withTenant(context, (tx) =>
          tx.telephonyMemberBinding.upsert({
            where,
            create: { tenantId: context.tenantId, memberId, seatError },
            update: { seatError },
          }),
        );
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: `快马：${seatError}`,
          fieldErrors: { seat: ['TELEPHONY_SEAT_FAILED'] },
        });
      }
    }
    const saved = await this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony`);
      const current = await tx.telephonyMemberBinding.findUnique({ where });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const usage = await readUsage(tx, context.tenantId);
      // Someone may have taken the last seat while the supplier was working;
      // keep the seat it made, but leave calling off.
      const full =
        input.enabled &&
        !current?.enabled &&
        (!usage.planId || usage.seatsEnabled >= usage.seats);
      const data = {
        version: input.version + 1,
        enabled: input.enabled && !full,
        phone,
        seatError: null,
        ...(seat
          ? {
              seatId: seat.seatId,
              providerUsername: seat.username,
              seatCreatedAt:
                current?.seatId === seat.seatId && current.seatCreatedAt
                  ? current.seatCreatedAt
                  : new Date(),
            }
          : {}),
      };
      const binding = await tx.telephonyMemberBinding.upsert({
        where,
        create: { tenantId: context.tenantId, memberId, ...data },
        update: data,
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'telephony.member_updated',
        resourceType: 'telephony_member',
        resourceId: memberId,
        requestId: randomUUID(),
        after: {
          enabled: binding.enabled,
          version: binding.version,
          seatId: binding.seatId || null,
        },
      });
      return { binding, full, usage, line: await this.line.read(tx) };
    });
    if (saved.full) {
      if (!saved.usage.planId) notEnabled();
      seatsFull(saved.usage.seats);
    }
    return this.bindingView(
      { id: memberId, displayName, status: before.member.status },
      saved.binding,
      saved.line.mode,
    );
  }

  /** The first unmet condition, in the order the specification lists them. */
  private reason(
    usage: Usage,
    line: LineRow,
    binding: { enabled: boolean; phone: string; seatId: string } | null,
  ): TelephonyReason | null {
    if (!usage.planId) return 'NOT_ENABLED';
    if (this.line.problems(line).length) return 'PLATFORM_NOT_READY';
    if (usage.usedMinutes >= allowance(usage)) return 'MINUTES_EXHAUSTED';
    if (
      !binding?.enabled ||
      !binding.phone ||
      !seatUsable(binding.seatId, line.mode)
    )
      return 'MEMBER_NOT_CONFIGURED';
    return null;
  }

  async runtime(context: TenantContext, query: TelephonyRuntimeQueryDto) {
    if (query.recordId && !query.objectCode)
      throw new ApiException('VALIDATION_FAILED', 400);
    const { settings, binding, open, usage, line, history } =
      await this.runner.withTenant(context, async (tx) => ({
        settings: await tx.telephonySettings.findUnique({
          where: { tenantId: context.tenantId },
        }),
        binding: await tx.telephonyMemberBinding.findUnique({
          where: {
            tenantId_memberId: {
              tenantId: context.tenantId,
              memberId: context.memberId,
            },
          },
        }),
        open: await tx.telephonyCall.findFirst({
          where: {
            tenantId: context.tenantId,
            actorMemberId: context.memberId,
            status: { in: OPEN },
          },
          select: { id: true },
        }),
        usage: await readUsage(tx, context.tenantId),
        line: await this.line.read(tx),
        history: await tx.telephonyCall.findFirst({
          where: { tenantId: context.tenantId },
          select: { id: true },
        }),
      }));
    let fields: Array<{ fieldKey: string; label: string }> = [];
    if (query.objectCode && usage.planId) {
      const { visibleSchema } = await this.objects.resolveRuntimeSchema(
        context,
        query.objectCode,
      );
      const record = query.recordId
        ? await this.records.detail(context, query.objectCode, query.recordId)
        : null;
      const configured =
        fieldsOf(settings).find(
          (entry) => entry.objectCode === query.objectCode,
        )?.fieldKeys ?? [];
      fields = visibleSchema.fields
        .filter(
          (field) =>
            configured.includes(field.fieldKey) &&
            ['PHONE', 'TEXT'].includes(field.type) &&
            (record
              ? Object.hasOwn(record.values, field.fieldKey)
              : visibleSchema.queryFieldKeys
                ? visibleSchema.queryFieldKeys.includes(field.fieldKey)
                : field.access !== 'HIDDEN'),
        )
        .map(({ fieldKey, label }) => ({ fieldKey, label }));
    }
    const reason = this.reason(usage, line, binding);
    return {
      enabled: Boolean(usage.planId),
      hasHistory: Boolean(history),
      mode: line.mode,
      available: reason === null,
      reason,
      callerPhone: binding?.phone || null,
      liveEnabled: this.line.liveEnabled(),
      openCallId: open?.id ?? null,
      fields,
    };
  }
```

- [ ] **Step 3: 改拨号**

在 `createCall` 里：

1. `return { call: existing, fresh: false, settings: null };` 改成 `return { call: existing, fresh: false, line: null };`
2. 从 `const [settings, binding] = await Promise.all([` 到 `if (reason) unavailable(reason);` 这一段换成：

```ts
        const [settings, binding] = await Promise.all([
          tx.telephonySettings.findUnique({
            where: { tenantId: context.tenantId },
          }),
          tx.telephonyMemberBinding.findUnique({
            where: {
              tenantId_memberId: {
                tenantId: context.tenantId,
                memberId: context.memberId,
              },
            },
          }),
        ]);
        const usage = await readUsage(tx, context.tenantId);
        const line = await this.line.read(tx);
        const reason = this.reason(usage, line, binding);
        if (!binding || !binding.phone)
          unavailable(reason ?? 'MEMBER_NOT_CONFIGURED');
        if (
          !fieldsOf(settings).some(
            (entry) =>
              entry.objectCode === input.objectCode &&
              entry.fieldKeys.includes(input.fieldKey),
          )
        )
          throw new ApiException('FIELD_HIDDEN', 403);
        // A replay above returns its durable target. Only a missing request must
        // still match the tuple explicitly reviewed by the client.
        const callerPhone = normalizePhone(binding.phone);
        const calleePhone = normalizePhone(record.values[input.fieldKey]);
        if (
          input.confirmation.mode !== line.mode ||
          normalizePhone(input.confirmation.callerPhone) !== callerPhone ||
          normalizePhone(input.confirmation.calleePhone) !== calleePhone
        )
          throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
            message: '拨打信息已变化，请重新核对后确认。',
            fieldErrors: { confirmation: ['TELEPHONY_CONFIRMATION_CHANGED'] },
          });
        if (reason) unavailable(reason);
```

3. `telephonyCall.create` 的 data 里 `mode: settings.mode,` 改成 `mode: line.mode,`；`return { call, fresh: true, settings };` 改成 `return { call, fresh: true, line };`。
4. `} else {` 分支里，从 `// The request is durable before …` 到 `const collision = …;` 结束换成：

```ts
        // The request is durable before this single, non-transactional network call.
        const account = this.line.account(result.line!);
        const outcome = await this.provider.dial(
          {
            companyId: account.companyId,
            appSecret: account.appSecret,
            caller: call.callerPhone,
            callee: call.calleePhone,
          },
          fetch,
          undefined,
          account.origin,
        );
        call = await this.runner.withTenant(context, async (tx) => {
          await tx.$queryRaw`SELECT id FROM telephony_calls WHERE tenant_id = ${context.tenantId}::uuid AND id = ${call.id}::uuid FOR UPDATE`;
          const current = await tx.telephonyCall.findUniqueOrThrow({
            where: { id: call.id },
          });
          // A manual close may have ended the call meanwhile; keep that status
          // but still attach the supplier ID so a late outcome can find it.
          const status =
            current.status === 'REQUESTED' ? outcome.status : current.status;
          if (outcome.providerBindId)
            await this.lock(tx, `telephony-bind:${outcome.providerBindId}`);
          // One supplier account serves every company: a supplier ID already
          // used anywhere is ambiguous, so do not attach it.
          const [owner] = outcome.providerBindId
            ? await tx.$queryRaw<
                Array<{ tenant_id: string | null }>
              >`SELECT telephony_route_bind(${outcome.providerBindId})::text AS tenant_id`
            : [];
          const collision = Boolean(owner?.tenant_id);
```

后面的 `return tx.telephonyCall.update({ … data: collision ? … : … })` 保持不变。

- [ ] **Step 4: 改回调**

把 `authenticateHook`、`hookContext`、`hook`、`hangup` 四个方法换成下面这些（`lockByBindId`、`merge` 和文件末尾的 `parseSupplierTime` 不变），并删掉整个 `rotateCallbackToken` 方法（它在 Step 2 替换的范围里已经没有了）：

```ts
  /** Bearer header, or the `token` query parameter of the URL given to the supplier. */
  async authenticateHook(
    authorization?: string,
    queryToken?: unknown,
  ): Promise<void> {
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : typeof queryToken === 'string'
        ? queryToken
        : '';
    if (!supplied) throw new ApiException('AUTH_REQUIRED', 401);
    const line = await this.runner.withUser(ZERO_UUID, (tx) =>
      this.line.read(tx),
    );
    if (!line.callbackTokenEncrypted)
      throw new ApiException('AUTH_REQUIRED', 401);
    let expected: Buffer;
    try {
      expected = Buffer.from(
        this.line.vault.open('callbackToken', line.callbackTokenEncrypted),
      );
    } catch {
      throw new ApiException('AUTH_REQUIRED', 401);
    }
    const given = Buffer.from(supplied);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new ApiException('AUTH_REQUIRED', 401);
  }

  private hookContext(tenantId: string): TenantContext {
    // A verified callback acts only on the company that owns the supplier call.
    return {
      tenantId,
      tenantCode: '',
      userId: ZERO_UUID,
      memberId: ZERO_UUID,
      role: 'EMPLOYEE',
    };
  }

  /** Which company a supplier call ID belongs to; unknown IDs are 404 so the supplier retries. */
  private async routeBind(bindId: string) {
    const [row] = await this.runner.withUser(ZERO_UUID, (tx) =>
      tx.$queryRaw<
        Array<{ tenant_id: string | null }>
      >`SELECT telephony_route_bind(${bindId})::text AS tenant_id`,
    );
    if (!row?.tenant_id) throw new ApiException('RECORD_NOT_FOUND', 404);
    return row.tenant_id;
  }

  async hook(input: TelephonyHookDto) {
    // 挂断状态 has no push_type; an End status is only ever an end event.
    if (input.push_type === undefined || input.status === 'End')
      return this.hangup(input);
    const recordingUrl = input.audio_url
      ? safeRecordingUrl(input.audio_url)
      : null;
    if (
      !input.seats_id ||
      !input.telA ||
      !input.telB ||
      (input.push_type === 1 && !['1', '0'].includes(input.status ?? '')) ||
      (input.push_type === 2 && !recordingUrl)
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    const caller = normalizePhone(input.telA);
    const callee = normalizePhone(input.telB);
    const beganAt = parseSupplierTime(input.begin_time);
    const endedAt = parseSupplierTime(input.end_time);
    if (beganAt && endedAt && endedAt < beganAt)
      throw new ApiException('VALIDATION_FAILED', 400);
    const tenantId = await this.routeBind(input.bind_id);
    return this.runner.withTenant(this.hookContext(tenantId), async (tx) => {
      const call = await this.lockByBindId(tx, tenantId, input.bind_id);
      if (
        call.callerPhone !== caller ||
        call.calleePhone !== callee ||
        call.seatId !== input.seats_id
      )
        throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      await this.merge(tx, call, {
        status:
          input.push_type === 2
            ? call.status
            : input.status === '1'
              ? 'CONNECTED'
              : 'NOT_CONNECTED',
        recordingUrl,
        durationSeconds: input.duration ?? null,
        beganAt,
        endedAt,
      });
      return { code: 0 };
    });
  }

  /** 挂断状态回调: an end event only; it never says whether anyone answered. */
  private async hangup(input: TelephonyHookDto) {
    if (input.status !== 'End')
      throw new ApiException('VALIDATION_FAILED', 400);
    const endedAt = parseSupplierTime(input.time ?? input.end_time);
    const tenantId = await this.routeBind(input.bind_id);
    return this.runner.withTenant(this.hookContext(tenantId), async (tx) => {
      const call = await this.lockByBindId(tx, tenantId, input.bind_id);
      if (OPEN.includes(call.status))
        await tx.telephonyCall.update({
          where: { id: call.id },
          data: { status: 'ENDED', endedAt: call.endedAt ?? endedAt },
        });
      return { code: 0 };
    });
  }
```

- [ ] **Step 5: 改控制器**

在 `telephony.controller.ts` 里：

1. 从 import 列表删掉 `TelephonyCallbackTokenResponseDto`。
2. 删掉整个 `@Post('settings/callback-token') … rotateCallbackToken(…) { … }` 方法。
3. `TelephonyHookGuard.canActivate` 换成：

```ts
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      query: Record<string, unknown>;
    }>();
    await this.telephony.authenticateHook(
      request.headers.authorization,
      request.query?.token,
    );
    return true;
  }
```

4. `TelephonyHookController` 的 `hook` 方法换成（删掉 `@ApiParam` 和 `tenantId` 参数）：

```ts
  @Post()
  @HttpCode(200)
  @SetMetadata('telephony:authenticated-hook', true)
  @UseGuards(TelephonyHookGuard)
  @ApiHeader({
    name: 'Authorization',
    required: false,
    description: 'Bearer callback credential; or pass it as the token query',
  })
  @ApiQuery({ name: 'token', required: false })
  @ApiOkResponse({ type: TelephonyHookResponseDto })
  @ApiBody({ type: TelephonyHookDto })
  async hook(
    // Untyped so the global pipe does not reject fields the supplier may add;
    // the known fields are still validated strictly below.
    @Body() raw: unknown,
  ) {
    const input = plainToInstance(
      TelephonyHookDto,
      raw && typeof raw === 'object' ? raw : {},
    );
    const errors = await validate(input, { whitelist: true });
    if (errors.length)
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: validationFieldErrors(errors),
      });
    return this.telephony.hook(input);
  }
```

如果 `ParseUUIDPipe`、`ApiParam` 仍被其他方法用到就保留 import，否则删掉。

- [ ] **Step 6: 注册新服务**

`integrations.module.ts` 加两个 import，并把它们放进 `providers`：

```ts
import { TelephonyLine } from './telephony/telephony-line';
import { TelephonySeats } from './telephony/telephony-seats';
```

```ts
  providers: [
    IntegrationsService,
    TelephonyService,
    TelephonyHookGuard,
    KuaimaProvider,
    TelephonyLine,
    TelephonySeats,
  ],
```

- [ ] **Step 7: 类型检查、lint 和单元测试**

Run: `pnpm --filter @crm/api typecheck && pnpm --filter @crm/api exec eslint src/modules/integrations && cd apps/api && npx jest src/modules/integrations`
Expected: 类型检查无错误；lint 无错误；`telephony-provider`、`telephony-line`、`telephony-seats` 三个 spec 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/modules/integrations
git commit -m "$(cat <<'EOF'
电话外呼公司侧：读平台线路和套餐，自动建坐席，回调地址统一

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 平台接口（线路、套餐、开通、加分钟、收支）和端到端测试

**Files:**
- Create: `apps/api/src/modules/integrations/telephony/telephony-platform.dto.ts`
- Create: `apps/api/src/modules/integrations/telephony/telephony-platform.service.ts`
- Create: `apps/api/src/modules/integrations/telephony/telephony-platform.controller.ts`
- Modify: `apps/api/src/modules/integrations/integrations.module.ts`
- Create: `apps/api/test/helpers/telephony-fixture.ts`
- Create: `apps/api/test/platform-telephony.e2e-spec.ts`
- Modify: `apps/api/test/telephony.e2e-spec.ts`
- Modify: `apps/api/package.json`（`test:e2e:critical`）

**Interfaces:**
- Consumes: Task 1 的函数；Task 3 的 `TelephonyLine`、`readUsage`、`allowance`、`seatUsername`；Task 4 的公司侧接口。
- Produces（网页依赖，路径都在 `/api/v1` 下，要求平台管理员）：
  - `GET / PATCH platform/telephony-settings` → `PlatformTelephonyResponseDto { version, mode, companyId, hasAppSecret, hasCallbackToken, callbackEndpoint, liveEnabled, mockAllowed, costPerMinute, seatMonthlyCost, ready, problems: string[], seats }`；PATCH 收 `{ version, mode?, companyId?, appSecret?, costPerMinute?, seatMonthlyCost? }`。
  - `POST platform/telephony-settings/callback-token` → `{ settings, callbackUrl }`。
  - `GET platform/telephony-plans` → `TelephonyPlanResponseDto[] { id, name, seats, monthlyMinutes, monthlyPrice, assignable, version, companies }`；`POST`（201）收 `{ name, seats, monthlyMinutes, monthlyPrice, assignable }`；`PATCH platform/telephony-plans/{id}` 另收 `version`；`DELETE platform/telephony-plans/{id}?version=` 返回 204。
  - `GET / PATCH platform/tenants/{tenantId}/telephony` → `PlatformTenantTelephonyResponseDto { tenantId, version, planId, planName, seats, monthlyMinutes, month, usedMinutes, extraMinutes, allowance, seatsEnabled, additions: Array<{ month, minutes, price, note, createdAt }> }`；PATCH 收 `{ version, planId: string | null }`。
  - `POST platform/tenants/{tenantId}/telephony/minutes` 收 `{ month: 'YYYY-MM-01', minutes, price, note?, idempotencyKey }` → `{ applied, month }`。
  - `GET platform/telephony-report?month=YYYY-MM` → `{ month, seatMonthlyCost, rows: Array<{ tenantId, tenantName, planName, monthlyMinutes, usedMinutes, extraMinutes, allowance, planPrice, extraPrice, revenue, minuteCost, seatCost, cost, margin, seatsProvisioned }>, total: { usedMinutes, revenue, cost, margin } }`。
  - 审计动作：`telephony.line_updated`、`telephony.callback_token_rotated`、`telephony.plan_created`、`telephony.plan_updated`、`telephony.plan_deleted`、`telephony.plan_assigned`、`telephony.minutes_added`。
  - 测试帮手 `apps/api/test/helpers/telephony-fixture.ts`：`TELEPHONY_ORIGIN`、`TELEPHONY_KEYRING`、`TEST_PLAN_PREFIX`、`assertLocalTestDatabase()`、`telephonyHttp(h)`、`cleanupTelephony(h)`、`promotePlatformAdmin(h, f)`、`configureLine(h, f, mode?, extra?) → token`、`createPlan(h, f, overrides?) → { id, name, version }`、`assignPlan(h, f, tenantId, planId | null)`。

- [ ] **Step 1: 写测试帮手**

`apps/api/test/helpers/telephony-fixture.ts`：

```ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CRITICAL_TENANT_A,
  CRITICAL_TENANT_B,
  type CriticalFixture,
  type CriticalHarness,
} from './critical-fixture';

export const TELEPHONY_ORIGIN = 'http://localhost:3000';
export const TELEPHONY_KEYRING = JSON.stringify({
  activeKeyId: 'telephony-test',
  keys: { 'telephony-test': Buffer.alloc(32, 7).toString('base64') },
});
export const TEST_PLAN_PREFIX = 'e2e 通话 ';
const LINE = '/api/v1/platform/telephony-settings';

/** Refuses to run anywhere but a local throwaway test database. */
export function assertLocalTestDatabase() {
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? '');
  const runtime = new URL(process.env.TEST_DATABASE_URL ?? '');
  for (const target of [url, runtime]) {
    expect(['postgres:', 'postgresql:']).toContain(target.protocol);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
    const ephemeralCi =
      process.env.CI === 'true' &&
      target.port === '5432' &&
      target.pathname === '/crm' &&
      ['crm', 'crm_app'].includes(target.username);
    expect(
      ephemeralCi || /^\/[a-z0-9_]*test[a-z0-9_]*$/i.test(target.pathname),
    ).toBe(true);
    expect(
      [...target.searchParams.keys()].every((key) => key === 'schema'),
    ).toBe(true);
  }
  expect(runtime.host + runtime.pathname).toBe(url.host + url.pathname);
  expect(runtime.username).toBe('crm_app');
}

export function telephonyHttp(h: CriticalHarness) {
  const server = () => h.app.getHttpServer();
  return {
    get: (path: string, cookie: string) =>
      request(server()).get(path).set('Cookie', cookie),
    post: (path: string, body: object | undefined, cookie: string) =>
      request(server())
        .post(path)
        .set('Origin', TELEPHONY_ORIGIN)
        .set('Cookie', cookie)
        .send(body ?? {}),
    patch: (path: string, body: object, cookie: string) =>
      request(server())
        .patch(path)
        .set('Origin', TELEPHONY_ORIGIN)
        .set('Cookie', cookie)
        .send(body),
    delete: (path: string, cookie: string) =>
      request(server())
        .delete(path)
        .set('Origin', TELEPHONY_ORIGIN)
        .set('Cookie', cookie),
  };
}

/** Removes everything the telephony specs create and resets the platform line. */
export async function cleanupTelephony(h: CriticalHarness) {
  const db = h.adminDatabase;
  const tenants = await db.tenant.findMany({
    where: { code: { in: [CRITICAL_TENANT_A, CRITICAL_TENANT_B] } },
    select: { id: true },
  });
  const where = { tenantId: { in: tenants.map(({ id }) => id) } };
  await db.telephonyCall.deleteMany({ where });
  await db.telephonyMemberBinding.deleteMany({ where });
  await db.telephonySettings.deleteMany({ where });
  await db.telephonyMinuteAddition.deleteMany({ where });
  await db.telephonyTenantMonth.deleteMany({ where });
  await db.telephonyPlanHistory.deleteMany({ where });
  await db.tenantTelephonyConfig.deleteMany({ where });
  await db.memberNotification.deleteMany({
    where: {
      ...where,
      kind: { in: ['TELEPHONY_MINUTES_80', 'TELEPHONY_MINUTES_100'] },
    },
  });
  await db.telephonyPlan.deleteMany({
    where: { name: { startsWith: TEST_PLAN_PREFIX } },
  });
  await db.telephonyPlatformSettings.update({
    where: { id: true },
    data: {
      mode: 'MOCK',
      companyId: '',
      appSecretEncrypted: null,
      callbackTokenEncrypted: null,
      costPerMinute: 0,
      seatMonthlyCost: 0,
    },
  });
}

/** Tenant B's administrator doubles as the platform administrator. */
export async function promotePlatformAdmin(
  h: CriticalHarness,
  f: CriticalFixture,
) {
  await h.adminDatabase.user.update({
    where: { id: f.tenantBAdmin.userId },
    data: { isPlatformAdmin: true },
  });
}

/** Sets the platform line and issues a callback credential; returns the token. */
export async function configureLine(
  h: CriticalHarness,
  f: CriticalFixture,
  mode: 'MOCK' | 'KUAIMA' = 'MOCK',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const http = telephonyHttp(h);
  const cookie = f.tenantBAdmin.cookie;
  const current = await http.get(LINE, cookie);
  expect(current.status).toBe(200);
  const saved = await http.patch(
    LINE,
    {
      version: (current.body as { version: number }).version,
      mode,
      companyId: '131',
      appSecret: 'platform-secret',
      ...extra,
    },
    cookie,
  );
  expect(saved.status).toBe(200);
  const issued = await http.post(`${LINE}/callback-token`, undefined, cookie);
  expect(issued.status).toBe(200);
  return new URL(
    (issued.body as { callbackUrl: string }).callbackUrl,
  ).searchParams.get('token')!;
}

export async function createPlan(
  h: CriticalHarness,
  f: CriticalFixture,
  overrides: Record<string, unknown> = {},
) {
  const created = await telephonyHttp(h).post(
    '/api/v1/platform/telephony-plans',
    {
      name: `${TEST_PLAN_PREFIX}${randomUUID().slice(0, 8)}`,
      seats: 3,
      monthlyMinutes: 100,
      monthlyPrice: '120.00',
      assignable: true,
      ...overrides,
    },
    f.tenantBAdmin.cookie,
  );
  expect(created.status).toBe(201);
  return created.body as { id: string; name: string; version: number };
}

export async function assignPlan(
  h: CriticalHarness,
  f: CriticalFixture,
  tenantId: string,
  planId: string | null,
) {
  const http = telephonyHttp(h);
  const path = `/api/v1/platform/tenants/${tenantId}/telephony`;
  const current = await http.get(path, f.tenantBAdmin.cookie);
  expect(current.status).toBe(200);
  const saved = await http.patch(
    path,
    { version: (current.body as { version: number }).version, planId },
    f.tenantBAdmin.cookie,
  );
  expect(saved.status).toBe(200);
  return saved.body as { version: number; month: string };
}
```

- [ ] **Step 2: 写平台端到端测试**

`apps/api/test/platform-telephony.e2e-spec.ts`：

```ts
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@crm/database';
import {
  KuaimaProvider,
  KuaimaSeatError,
} from '../src/modules/integrations/telephony/telephony-provider';
import { seatUsername } from '../src/modules/integrations/telephony/telephony-seats';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import {
  assertLocalTestDatabase,
  assignPlan,
  cleanupTelephony,
  configureLine,
  createPlan,
  promotePlatformAdmin,
  telephonyHttp,
  TELEPHONY_KEYRING,
  TEST_PLAN_PREFIX,
} from './helpers/telephony-fixture';

jest.setTimeout(120_000);
const read = <T>(response: { body: unknown }) => response.body as T;
type Company = {
  version: number;
  month: string;
  planId: string | null;
  seatsEnabled: number;
};

describe('platform telephony', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let http: ReturnType<typeof telephonyHttp>;
  let outbound: jest.SpyInstance;
  let platform = '';
  const config = () => h.app.get(ConfigService);
  const LINE = '/api/v1/platform/telephony-settings';
  const PLANS = '/api/v1/platform/telephony-plans';
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/telephony`;
  const company = (tenantId = f.tenantA.id) =>
    `/api/v1/platform/tenants/${tenantId}/telephony`;
  const bind = (memberId: string, seatId: string) =>
    h.adminDatabase.telephonyMemberBinding.upsert({
      where: { tenantId_memberId: { tenantId: f.tenantA.id, memberId } },
      create: {
        tenantId: f.tenantA.id,
        memberId,
        enabled: true,
        phone: '13911113002',
        seatId,
        providerUsername: seatUsername(memberId),
        seatCreatedAt: new Date(),
      },
      update: { enabled: true, seatId, seatCreatedAt: new Date() },
    });
  const acceptedCall = (overrides: object = {}) =>
    h.adminDatabase.telephonyCall.create({
      data: {
        tenantId: f.tenantA.id,
        actorMemberId: f.employee.memberId,
        requestId: randomUUID(),
        objectId: f.object.id,
        objectCode: 'leads',
        recordId: f.ownedRecord.id,
        fieldKey: 'reviewCode',
        mode: 'KUAIMA',
        status: 'ACCEPTED',
        callerPhone: '13911113002',
        calleePhone: '13812345678',
        seatId: 'seat-1',
        providerBindId: randomUUID(),
        ...overrides,
      },
    });
  const hook = (token: string, bindId: string, overrides: object = {}) =>
    request(h.app.getHttpServer())
      .post(`/api/v1/telephony/hooks?token=${encodeURIComponent(token)}`)
      .send({
        push_type: 1,
        bind_id: bindId,
        seats_id: 'seat-1',
        telA: '13911113002',
        telB: '13812345678',
        status: '1',
        begin_time: '2026-10-30 12:00:00',
        end_time: '2026-10-30 12:01:01',
        duration: 61,
        ...overrides,
      });
  const usedMinutes = async (tenantId = f.tenantA.id) =>
    (
      await h.adminDatabase.telephonyTenantMonth.findMany({
        where: { tenantId },
      })
    ).reduce((sum, row) => sum + row.usedMinutes, 0);

  beforeAll(async () => {
    assertLocalTestDatabase();
    process.env.AI_MODEL_KEYRING = TELEPHONY_KEYRING;
    process.env.TELEPHONY_LIVE_ENABLED = 'false';
    outbound = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('Outbound network forbidden in platform telephony test')),
      );
    h = await createCriticalHarness();
    config().set('AI_MODEL_KEYRING', TELEPHONY_KEYRING);
    config().set('TELEPHONY_LIVE_ENABLED', 'false');
    http = telephonyHttp(h);
  });
  beforeEach(async () => {
    await cleanupTelephony(h);
    f = await provisionCriticalFixture(h);
    await promotePlatformAdmin(h, f);
    platform = f.tenantBAdmin.cookie;
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { data: { name: '客户', reviewCode: '+8613812345678' } },
    });
  });
  afterEach(() => {
    config().set('TELEPHONY_LIVE_ENABLED', 'false');
    config().set('NODE_ENV', 'test');
    jest.restoreAllMocks();
    outbound = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(new Error('Outbound network forbidden in platform telephony test')),
      );
  });
  afterAll(async () => {
    await cleanupTelephony(h);
    await closeCriticalHarness(h);
    outbound.mockRestore();
  });

  it('keeps the line for platform admins, seals secrets and names what is missing', async () => {
    expect((await http.get(LINE, f.admin.cookie)).status).toBe(403);
    const fresh = await http.get(LINE, platform);
    expect(fresh.body).toMatchObject({ mode: 'MOCK', ready: true, problems: [], hasAppSecret: false });
    const kuaima = await http.patch(
      LINE,
      {
        version: read<{ version: number }>(fresh).version,
        mode: 'KUAIMA',
        costPerMinute: '0.1500',
        seatMonthlyCost: '10.00',
      },
      platform,
    );
    expect(kuaima.status).toBe(200);
    expect(kuaima.body).toMatchObject({
      ready: false,
      problems: [
        '企业 ID 未填写',
        '企业密钥未填写',
        '回调地址未生成',
        '服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）',
      ],
      costPerMinute: '0.1500',
      seatMonthlyCost: '10.00',
    });
    const token = await configureLine(h, f, 'KUAIMA');
    const line = await http.get(LINE, platform);
    expect(line.body).toMatchObject({
      companyId: '131',
      hasAppSecret: true,
      hasCallbackToken: true,
      problems: ['服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）'],
      callbackEndpoint: expect.stringMatching(/\/api\/v1\/telephony\/hooks$/) as unknown,
    });
    expect(JSON.stringify(line.body)).not.toContain('platform-secret');
    expect(JSON.stringify(line.body)).not.toContain(token);
    const [row] = await h.adminDatabase.$queryRawUnsafe<
      Array<{ app_secret_encrypted: string; callback_token_encrypted: string }>
    >('SELECT app_secret_encrypted, callback_token_encrypted FROM telephony_platform_settings');
    expect(row.app_secret_encrypted).not.toContain('platform-secret');
    expect(row.callback_token_encrypted).not.toContain(token);
    config().set('TELEPHONY_LIVE_ENABLED', 'true');
    expect((await http.get(LINE, platform)).body).toMatchObject({ ready: true, problems: [] });
    // A blank secret keeps the saved one; a stale version conflicts.
    const version = read<{ version: number }>(line).version;
    expect((await http.patch(LINE, { version, appSecret: '' }, platform)).body).toMatchObject({ hasAppSecret: true });
    expect((await http.patch(LINE, { version, companyId: '132' }, platform)).status).toBe(409);
    config().set('NODE_ENV', 'production');
    expect((await http.patch(LINE, { version: version + 1, mode: 'MOCK' }, platform)).status).toBe(400);
    expect((await http.post(`${LINE}/callback-token`, undefined, f.admin.cookie)).status).toBe(403);
  });

  it('names plans uniquely, refuses deleting or shrinking a plan in use and records plan history', async () => {
    expect((await http.get(PLANS, f.admin.cookie)).status).toBe(403);
    const plan = await createPlan(h, f, { seats: 2 });
    const same = { name: plan.name, seats: 1, monthlyMinutes: 1, monthlyPrice: '1.00', assignable: true };
    expect((await http.post(PLANS, same, platform)).status).toBe(409);
    expect(
      (await http.post(PLANS, { ...same, name: `${TEST_PLAN_PREFIX}bad`, seats: 0, monthlyPrice: '1.001' }, platform)).status,
    ).toBe(400);
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await bind(f.employee.memberId, 'seat-a');
    await bind(f.otherEmployee.memberId, 'seat-b');
    const edit = { version: plan.version, name: plan.name, seats: 1, monthlyMinutes: 100, monthlyPrice: '120.00', assignable: true };
    const shrink = await http.patch(`${PLANS}/${plan.id}`, edit, platform);
    expect(shrink.status).toBe(409);
    expect(read<{ message: string }>(shrink).message).toContain('（2 个）');
    expect((await http.delete(`${PLANS}/${plan.id}?version=${plan.version}`, platform)).status).toBe(409);
    const renamed = await http.patch(
      `${PLANS}/${plan.id}`,
      { ...edit, name: `${plan.name} 改`, seats: 2, monthlyMinutes: 200, monthlyPrice: '150.00', assignable: false },
      platform,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      seats: 2,
      monthlyMinutes: 200,
      monthlyPrice: '150.00',
      assignable: false,
      companies: 1,
      version: plan.version + 1,
    });
    const history = await h.adminDatabase.telephonyPlanHistory.findMany({
      where: { tenantId: f.tenantA.id },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
    });
    expect(history.map((entry) => [entry.planName, entry.monthlyPrice.toFixed(2), entry.monthlyMinutes])).toEqual([
      [plan.name, '120.00', 100],
      [`${plan.name} 改`, '150.00', 200],
    ]);
    // A plan that stopped being assignable cannot go to another company.
    const other = read<Company>(await http.get(company(f.tenantB.id), platform));
    expect(
      (await http.patch(company(f.tenantB.id), { version: other.version, planId: plan.id }, platform)).status,
    ).toBe(400);
    await assignPlan(h, f, f.tenantA.id, null);
    expect((await http.delete(`${PLANS}/${plan.id}?version=${plan.version + 1}`, platform)).status).toBe(204);
  });

  it('assigns plans within seat limits and adds minutes once per key with an audit trail', async () => {
    const started = new Date();
    const small = await createPlan(h, f, { seats: 1 });
    const big = await createPlan(h, f, { seats: 3 });
    await assignPlan(h, f, f.tenantA.id, big.id);
    await bind(f.employee.memberId, 'seat-a');
    await bind(f.otherEmployee.memberId, 'seat-b');
    const current = read<Company>(await http.get(company(), platform));
    expect(current).toMatchObject({ planId: big.id, seatsEnabled: 2 });
    const refused = await http.patch(company(), { version: current.version, planId: small.id }, platform);
    expect(refused.status).toBe(409);
    expect(read<{ message: string }>(refused).message).toContain('已开 2 个坐席');
    expect((await http.patch(company(), { version: current.version - 1, planId: null }, platform)).status).toBe(409);
    const key = randomUUID();
    const add = (minutes = 50) =>
      http.post(
        `${company()}/minutes`,
        { month: current.month, minutes, price: '30.00', note: '月中加量', idempotencyKey: key },
        platform,
      );
    expect((await add()).body).toEqual({ applied: true, month: current.month });
    expect((await add()).body).toEqual({ applied: false, month: current.month });
    expect((await add(60)).status).toBe(409);
    expect(
      (await http.post(`${company()}/minutes`, { month: '2020-01-01', minutes: 1, price: '0.00', idempotencyKey: randomUUID() }, platform)).status,
    ).toBe(409);
    expect((await http.get(company(), platform)).body).toMatchObject({
      extraMinutes: 50,
      allowance: 150,
      additions: [{ minutes: 50, price: '30.00', note: '月中加量' }],
    });
    const audits = await h.adminDatabase.auditLog.findMany({
      where: {
        tenantId: f.tenantA.id,
        createdAt: { gte: started },
        action: { in: ['telephony.plan_assigned', 'telephony.minutes_added'] },
      },
    });
    expect(audits.map((entry) => entry.action).sort()).toEqual([
      'telephony.minutes_added',
      'telephony.plan_assigned',
    ]);
  });

  it('shows a company its plan and usage without money or the platform account', async () => {
    const plan = await createPlan(h, f, { monthlyPrice: '987.65' });
    await configureLine(h, f, 'MOCK');
    await assignPlan(h, f, f.tenantA.id, plan.id);
    const month = read<Company>(await http.get(company(), platform)).month;
    await http.post(`${company()}/minutes`, { month, minutes: 5, price: '4.32', idempotencyKey: randomUUID() }, platform);
    const settings = await http.get(`${base()}/settings`, f.admin.cookie);
    expect(settings.body).toMatchObject({
      plan: { name: plan.name, seats: 3, monthlyMinutes: 100 },
      usage: { usedMinutes: 0, extraMinutes: 5, allowance: 105, seatsEnabled: 0 },
      lineReady: true,
    });
    const text = [
      settings.body,
      (await http.get(`${base()}/runtime`, f.employee.cookie)).body,
      (await http.get(`${base()}/members`, f.admin.cookie)).body,
    ]
      .map((body) => JSON.stringify(body))
      .join('');
    for (const leak of ['987.65', '4.32', 'platform-secret', 'companyId', 'Price', 'cost'])
      expect(text).not.toContain(leak);
    const asMember = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      h.runtimeDatabase.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${f.admin.userId}, true), set_config('app.tenant_id', ${f.tenantA.id}, true)`;
        return work(tx);
      });
    const counts = await asMember(async (tx) => {
      const count = async (table: string) =>
        (await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
      return {
        line: await count('telephony_platform_settings'),
        plans: await count('telephony_plans'),
        history: await count('telephony_plan_history'),
        additions: await count('telephony_minute_additions'),
        config: await count('tenant_telephony_configs'),
      };
    });
    expect(counts).toEqual({ line: 0, plans: 0, history: 0, additions: 0, config: 1 });
    await expect(
      asMember((tx) => tx.$queryRaw`SELECT * FROM telephony_report(date_trunc('month', now())::date)`),
    ).rejects.toThrow();
  });

  it('creates seats on its own, adopts a half-saved seat and keeps calling off when the supplier refuses', async () => {
    const plan = await createPlan(h, f, { seats: 1 });
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await configureLine(h, f, 'MOCK');
    const members = `${base()}/members`;
    const mock = await http.patch(`${members}/${f.employee.memberId}`, { version: 0, enabled: true, phone: '13911113002' }, f.admin.cookie);
    expect(mock.status).toBe(200);
    expect(mock.body).toMatchObject({ enabled: true, seatStatus: 'READY', seatError: null, version: 1 });
    const where = { tenantId_memberId: { tenantId: f.tenantA.id, memberId: f.employee.memberId } };
    expect((await h.adminDatabase.telephonyMemberBinding.findUniqueOrThrow({ where })).seatId).toBe(
      `MOCK-${seatUsername(f.employee.memberId)}`,
    );
    const full = await http.patch(`${members}/${f.otherEmployee.memberId}`, { version: 0, enabled: true, phone: '13911113003' }, f.admin.cookie);
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ fieldErrors: { telephony: ['TELEPHONY_SEATS_FULL'] } });

    // On the supplier line a simulated seat counts as none.
    await configureLine(h, f, 'KUAIMA');
    config().set('TELEPHONY_LIVE_ENABLED', 'true');
    const provider = h.app.get(KuaimaProvider);
    const find = jest.spyOn(provider, 'findSeat').mockResolvedValue(null);
    const create = jest
      .spyOn(provider, 'createSeat')
      .mockRejectedValueOnce(new KuaimaSeatError('手机号已被其他坐席使用'));
    const update = jest.spyOn(provider, 'updateSeat').mockResolvedValue(undefined);
    expect((await http.get(`${base()}/runtime`, f.employee.cookie)).body).toMatchObject({
      reason: 'MEMBER_NOT_CONFIGURED',
    });
    const refused = await http.patch(`${members}/${f.employee.memberId}`, { version: 1, enabled: true, phone: '13911113004' }, f.admin.cookie);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      message: '快马：手机号已被其他坐席使用',
      fieldErrors: { seat: ['TELEPHONY_SEAT_FAILED'] },
    });
    const listed = read<{ members: Array<{ memberId: string }> }>(await http.get(members, f.admin.cookie));
    expect(listed.members.find((entry) => entry.memberId === f.employee.memberId)).toMatchObject({
      seatStatus: 'FAILED',
      seatError: '手机号已被其他坐席使用',
      version: 1,
    });
    // The retry finds the seat the supplier made last time and adopts it.
    find.mockResolvedValueOnce({ id: '9001', username: seatUsername(f.employee.memberId), mobile: '13911110000' });
    const adopted = await http.patch(`${members}/${f.employee.memberId}`, { version: 1, enabled: true, phone: '13911113004' }, f.admin.cookie);
    expect(adopted.status).toBe(200);
    expect(adopted.body).toMatchObject({ enabled: true, seatStatus: 'READY', seatError: null, version: 2 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: '131', appSecret: 'platform-secret' }),
      '9001',
      expect.objectContaining({ mobile: '13911113004' }),
    );
    // A new mobile on a real seat only updates it.
    expect(
      (await http.patch(`${members}/${f.employee.memberId}`, { version: 2, enabled: true, phone: '13911113005' }, f.admin.cookie)).status,
    ).toBe(200);
    expect(update).toHaveBeenLastCalledWith(expect.anything(), '9001', expect.objectContaining({ mobile: '13911113005' }));
    expect(find).toHaveBeenCalledTimes(2);
    const saved = await h.adminDatabase.telephonyMemberBinding.findUniqueOrThrow({ where });
    expect(saved).toMatchObject({
      seatId: '9001',
      providerUsername: seatUsername(f.employee.memberId),
      phone: '13911113005',
    });
    expect(saved.seatCreatedAt).not.toBeNull();
  });

  it('lets only one of two simultaneous requests take the last seat', async () => {
    const plan = await createPlan(h, f, { seats: 1 });
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await configureLine(h, f, 'MOCK');
    const turnOn = (memberId: string, phone: string) =>
      http.patch(`${base()}/members/${memberId}`, { version: 0, enabled: true, phone }, f.admin.cookie);
    const results = await Promise.all([
      turnOn(f.employee.memberId, '13911113002'),
      turnOn(f.otherEmployee.memberId, '13911113003'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await h.adminDatabase.telephonyMemberBinding.count({ where: { tenantId: f.tenantA.id, enabled: true } }),
    ).toBe(1);
  });

  it('bills whole minutes once, stops dialing when minutes run out and tells administrators at 80% and 100%', async () => {
    const token = await configureLine(h, f, 'KUAIMA', { costPerMinute: '0.1500' });
    config().set('TELEPHONY_LIVE_ENABLED', 'true');
    const plan = await createPlan(h, f, { monthlyMinutes: 5 });
    await assignPlan(h, f, f.tenantA.id, plan.id);
    expect(
      (await http.patch(`${base()}/settings`, { version: 0, phoneFields: [{ objectCode: 'leads', fieldKeys: ['reviewCode'] }] }, f.admin.cookie)).status,
    ).toBe(200);
    await bind(f.employee.memberId, 'seat-1');
    const notices = async (kind: string) =>
      (await h.adminDatabase.memberNotification.findMany({ where: { tenantId: f.tenantA.id, kind } })).map(
        (entry) => entry.recipientMemberId,
      );

    const first = await acceptedCall();
    expect((await hook(token, first.providerBindId!)).status).toBe(200);
    expect((await hook(token, first.providerBindId!)).status).toBe(200);
    expect(await h.adminDatabase.telephonyCall.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      billedMinutes: 2,
    });
    expect((await h.adminDatabase.telephonyCall.findUniqueOrThrow({ where: { id: first.id } })).costPerMinute.toFixed(4)).toBe('0.1500');
    const second = await acceptedCall();
    await hook(token, second.providerBindId!, { duration: 60 });
    const missed = await acceptedCall();
    await hook(token, missed.providerBindId!, { status: '0', duration: 0 });
    expect(await usedMinutes()).toBe(3);
    expect(await notices('TELEPHONY_MINUTES_80')).toEqual([]);
    // Recording first, outcome later: still billed once.
    const recorded = await acceptedCall();
    expect(
      (await hook(token, recorded.providerBindId!, { push_type: 2, audio_url: 'https://records.example.com/a.mp3' })).status,
    ).toBe(200);
    await hook(token, recorded.providerBindId!, { duration: 30 });
    expect(await usedMinutes()).toBe(4);
    const eighty = await notices('TELEPHONY_MINUTES_80');
    expect(eighty).toContain(f.admin.memberId);
    expect(eighty).not.toContain(f.employee.memberId);
    const last = await acceptedCall();
    await hook(token, last.providerBindId!, { duration: 59 });
    await hook(token, last.providerBindId!, { duration: 59 });
    expect(await usedMinutes()).toBe(5);
    expect(await notices('TELEPHONY_MINUTES_80')).toEqual(eighty);
    expect(await notices('TELEPHONY_MINUTES_100')).toHaveLength(eighty.length);
    expect((await http.get(`${base()}/runtime`, f.employee.cookie)).body).toMatchObject({
      available: false,
      reason: 'MINUTES_EXHAUSTED',
    });
    const dial = await http.post(
      `${base()}/calls`,
      {
        requestId: randomUUID(),
        objectCode: 'leads',
        recordId: f.ownedRecord.id,
        fieldKey: 'reviewCode',
        confirmation: { mode: 'KUAIMA', callerPhone: '13911113002', calleePhone: '13812345678' },
      },
      f.employee.cookie,
    );
    expect(dial.status).toBe(503);
    expect(dial.body).toMatchObject({ fieldErrors: { telephony: ['MINUTES_EXHAUSTED'] } });
    // Added minutes reopen dialing and never repeat a notice.
    const month = read<Company>(await http.get(company(), platform)).month;
    await http.post(`${company()}/minutes`, { month, minutes: 10, price: '5.00', idempotencyKey: randomUUID() }, platform);
    expect((await http.get(`${base()}/runtime`, f.employee.cookie)).body).toMatchObject({ available: true, reason: null });
    expect(await notices('TELEPHONY_MINUTES_80')).toEqual(eighty);
  });

  it('routes one callback address to each company by its supplier call ID', async () => {
    const token = await configureLine(h, f, 'KUAIMA');
    const plan = await createPlan(h, f);
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await assignPlan(h, f, f.tenantB.id, plan.id);
    const recordB = await h.adminDatabase.record.findFirstOrThrow({ where: { tenantId: f.tenantB.id } });
    const objectB = await h.adminDatabase.objectDefinition.findUniqueOrThrow({ where: { id: recordB.objectId } });
    const callA = await acceptedCall();
    const callB = await h.adminDatabase.telephonyCall.create({
      data: {
        tenantId: f.tenantB.id,
        actorMemberId: f.tenantBAdmin.memberId,
        requestId: randomUUID(),
        objectId: recordB.objectId,
        objectCode: objectB.code,
        recordId: recordB.id,
        fieldKey: 'phone',
        mode: 'KUAIMA',
        status: 'ACCEPTED',
        callerPhone: '13911113004',
        calleePhone: '13812345670',
        seatId: 'seat-b',
        providerBindId: randomUUID(),
      },
    });
    const numbersB = { seats_id: 'seat-b', telA: '13911113004', telB: '13812345670' };
    expect((await hook(token, callA.providerBindId!, { duration: 45 })).status).toBe(200);
    expect((await hook(token, callB.providerBindId!, { ...numbersB, duration: 125 })).status).toBe(200);
    expect(await usedMinutes(f.tenantA.id)).toBe(1);
    expect(await usedMinutes(f.tenantB.id)).toBe(3);
    // Company A's call ID with company B's numbers is refused.
    const strayA = await acceptedCall();
    expect((await hook(token, strayA.providerBindId!, numbersB)).status).toBe(403);
    expect((await hook(token, randomUUID())).status).toBe(404);
    expect((await hook(`${token}x`, callA.providerBindId!)).status).toBe(401);
  });

  it('reports revenue, cost and margin, using the last plan of the month', async () => {
    await configureLine(h, f, 'KUAIMA', { costPerMinute: '0.1500', seatMonthlyCost: '10.00' });
    const cheap = await createPlan(h, f, { monthlyPrice: '80.00' });
    const plan = await createPlan(h, f, { monthlyPrice: '120.00' });
    await assignPlan(h, f, f.tenantA.id, cheap.id);
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await bind(f.employee.memberId, '9001');
    await bind(f.otherEmployee.memberId, '9002');
    // A simulated seat costs nothing.
    await bind(f.admin.memberId, `MOCK-${seatUsername(f.admin.memberId)}`);
    const call = await acceptedCall({ seatId: '9001' });
    await h.adminDatabase.telephonyCall.update({
      where: { id: call.id },
      data: { status: 'CONNECTED', durationSeconds: 61 },
    });
    const month = read<Company>(await http.get(company(), platform)).month;
    expect(
      (await http.post(`${company()}/minutes`, { month, minutes: 30, price: '30.00', idempotencyKey: randomUUID() }, platform)).status,
    ).toBe(200);
    const report = await http.get(`/api/v1/platform/telephony-report?month=${month.slice(0, 7)}`, platform);
    expect(report.status).toBe(200);
    const body = read<{ seatMonthlyCost: string; rows: Array<{ tenantId: string }>; total: unknown }>(report);
    expect(body.seatMonthlyCost).toBe('10.00');
    expect(body.rows.find((entry) => entry.tenantId === f.tenantA.id)).toEqual({
      tenantId: f.tenantA.id,
      tenantName: expect.any(String) as unknown,
      planName: plan.name,
      monthlyMinutes: 100,
      usedMinutes: 2,
      extraMinutes: 30,
      allowance: 130,
      planPrice: '120.00',
      extraPrice: '30.00',
      revenue: '150.00',
      minuteCost: '0.30',
      seatCost: '20.00',
      cost: '20.30',
      margin: '129.70',
      seatsProvisioned: 2,
    });
    expect(body.total).toEqual({ usedMinutes: 2, revenue: '150.00', cost: '20.30', margin: '129.70' });
    expect((await http.get('/api/v1/platform/telephony-report?month=2026-13', platform)).status).toBe(400);
    expect(
      (await http.get(`/api/v1/platform/telephony-report?month=${month.slice(0, 7)}`, f.admin.cookie)).status,
    ).toBe(403);
  });
});
```

- [ ] **Step 3: 把公司侧 e2e 改成平台开通**

在 `apps/api/test/telephony.e2e-spec.ts` 里按顺序改：

1. import 区加：

```ts
import { seatUsername } from '../src/modules/integrations/telephony/telephony-seats';
import {
  assertLocalTestDatabase,
  assignPlan,
  cleanupTelephony,
  configureLine,
  createPlan,
  promotePlatformAdmin,
  TELEPHONY_KEYRING,
} from './helpers/telephony-fixture';
```

2. 删掉 `const keyring = JSON.stringify({…});` 和整个 `cleanupTelephonyFixture` 函数；在 `let hookToken = '';` 后加一行 `let planId = '';`。
3. `beforeAll` 里从 `const url = new URL(…)` 到 `expect(runtime.username).toBe('crm_app');` 换成 `assertLocalTestDatabase();`；两处 `keyring` 换成 `TELEPHONY_KEYRING`。
4. `beforeEach` 开头改为：

```ts
    await cleanupTelephony(h);
    f = await provisionCriticalFixture(h);
    await promotePlatformAdmin(h, f);
```

   `afterAll` 里的 `await cleanupTelephonyFixture();` 改成 `await cleanupTelephony(h);`。
5. `setup` 整个换成：

```ts
  /** The platform opens the line and assigns a plan; the member gets a seat. */
  async function setup(mode: 'MOCK' | 'KUAIMA' = 'MOCK') {
    confirmedMode = mode;
    hookToken = await configureLine(h, f, mode);
    planId = (await createPlan(h, f)).id;
    await assignPlan(h, f, f.tenantA.id, planId);
    const setting = await patch(`${base()}/settings`, {
      version: 0,
      phoneFields: [{ objectCode: 'leads', fieldKeys: ['reviewCode', 'name'] }],
    });
    expect(setting.status).toBe(200);
    // Seat creation needs the supplier; tests that dial start with a saved seat.
    await h.adminDatabase.telephonyMemberBinding.create({
      data: {
        tenantId: f.tenantA.id,
        memberId: f.employee.memberId,
        enabled: true,
        seatId: 'seat-1',
        phone: '13911113002',
        providerUsername: seatUsername(f.employee.memberId),
        seatCreatedAt: new Date(),
      },
    });
  }
```

6. `requires login and admin for settings and bindings`：`patch(`${base()}/settings`, { version: 0 }, f.employee.cookie)` 的请求体改成 `{ version: 0, phoneFields: [] }`（新的 DTO 要求 `phoneFields`，否则先返回 400）。
7. 整个 `encrypts secrets, omits them in responses and preserves blank updates with version conflict` 测试换成：

```ts
  it('keeps calling closed until the platform assigns a plan', async () => {
    await configureLine(h, f, 'MOCK');
    expect((await get(`${base()}/runtime`, f.employee.cookie)).body).toMatchObject({
      enabled: false,
      hasHistory: false,
      available: false,
      reason: 'NOT_ENABLED',
    });
    expect((await get(`${base()}/settings`)).body).toMatchObject({
      plan: null,
      usage: { usedMinutes: 0, allowance: 0 },
    });
    const closed = await patch(`${base()}/settings`, { version: 0, phoneFields: [] });
    expect(closed.status).toBe(403);
    expect(closed.body).toMatchObject({ fieldErrors: { telephony: ['NOT_ENABLED'] } });
    expect(
      (
        await patch(`${base()}/members/${f.employee.memberId}`, {
          version: 0,
          enabled: true,
          phone: '13911113002',
        })
      ).status,
    ).toBe(403);
    await setup();
    expect((await get(`${base()}/settings`)).body).toMatchObject({
      version: 1,
      plan: { seats: 3, monthlyMinutes: 100 },
      usage: { usedMinutes: 0, allowance: 100, seatsEnabled: 1 },
      lineReady: true,
    });
    expect((await get(`${base()}/runtime`, f.employee.cookie)).body).toMatchObject({
      enabled: true,
      available: true,
      reason: null,
      mode: 'MOCK',
    });
    expect((await patch(`${base()}/settings`, { version: 0, phoneFields: [] })).status).toBe(409);
  });
```

8. `rejects an unpersisted retry after confirmed %s changes without dialing`：
   - `await patch(`${base()}/settings`, { version: 1, enabled: false });` 改成 `await assignPlan(h, f, f.tenantA.id, null);`
   - 从 `await patch(`${base()}/settings`, { version: 2, …` 到 `if (changed === 'caller')` 那段的成员修改，换成：

```ts
      await assignPlan(h, f, f.tenantA.id, planId);
      if (changed === 'mode') await configureLine(h, f, 'KUAIMA');
      if (changed === 'caller')
        await patch(`${base()}/members/${f.employee.memberId}`, {
          version: 1,
          enabled: true,
          phone: '13911113003',
        });
```

9. `returns a persisted request before comparing confirmation with changed settings or numbers`：把对 `settings` 和 `members` 的两次 `patch` 换成下面三行；在测试最后加一个断言：

```ts
    await assignPlan(h, f, f.tenantA.id, null);
    await configureLine(h, f, 'KUAIMA');
    await h.adminDatabase.telephonyMemberBinding.update({
      where: { tenantId_memberId: { tenantId: f.tenantA.id, memberId: f.employee.memberId } },
      data: { seatId: 'seat-2', phone: '13911113003' },
    });
```

```ts
    // Turning the service off keeps the call log reachable.
    expect((await get(`${base()}/runtime`, f.employee.cookie)).body).toMatchObject({
      enabled: false,
      hasHistory: true,
      reason: 'NOT_ENABLED',
    });
```

10. `keeps live disabled, returns runtime allowed fields and never calls network`：`reason: 'LIVE_DISABLED'` 改为 `reason: 'PLATFORM_NOT_READY'`。
11. 所有 `` `/api/v1/telephony/hooks/${f.tenantA.id}` `` 改为 `'/api/v1/telephony/hooks'`（共 4 处：两个 `const hook = …`、`callback` 帮手、挂断测试里的 `` `…?token=${hookToken}` `` 改成 `` `/api/v1/telephony/hooks?token=${hookToken}` ``）。
12. `authenticates tenant and validates callback binding, phones, seat, payload and recording URL`：标题改为 `authenticates the platform credential and validates callback binding, phones, seat, payload and recording URL`；发往 `` `/api/v1/telephony/hooks/${f.tenantB.id}` `` 的那段换成：

```ts
    expect(
      (
        await request(h.app.getHttpServer())
          .post('/api/v1/telephony/hooks')
          .set('Authorization', `Bearer ${hookToken}x`)
          .send({})
      ).status,
    ).toBe(401);
```

13. `persists ambiguous submission as UNKNOWN, does not retry, rejects other calls, and production refuses MOCK`：标题去掉 `, and production refuses MOCK`；删掉 `config.set('NODE_ENV', 'production');` 和随后对 `settings` 的 `mode: 'MOCK'` 断言，以及 `finally` 里的 `config.set('NODE_ENV', 'test');`（这一项移到了平台测试）。
14. `accepts the credential in the callback URL, ignores fields the supplier adds and rejects a rotated credential`：两处 `` .post(`${base()}/settings/callback-token`) `` 改为 `.post('/api/v1/platform/telephony-settings/callback-token')`；第一处（重新生成）的 Cookie 用 `f.tenantBAdmin.cookie`，第二处（应当 403）的 Cookie 用 `f.admin.cookie`。
15. `shows the supplier refusal reason and frees the member when the line rejects the dial`：`expect.objectContaining({ appSecret: 'test-secret' })` 改为 `expect.objectContaining({ companyId: '131', appSecret: 'platform-secret' })`。

- [ ] **Step 4: 把平台测试加进关键测试集**

`apps/api/package.json` 的 `test:e2e:critical` 末尾 `test/telephony.e2e-spec.ts` 后面加 ` test/platform-telephony.e2e-spec.ts`。

- [ ] **Step 5: 确认测试失败**

Run: `.local/telephony/run-e2e.sh test/platform-telephony.e2e-spec.ts`
Expected: FAIL，平台接口全部 404（`expected 200, received 404`）。

- [ ] **Step 6: 写平台 DTO**

`telephony-platform.dto.ts`：

```ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TELEPHONY_MODES } from './telephony.dto';

/** Money in yuan: up to 10 integer digits and 2 decimals. */
export const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** A per-minute rate in yuan: up to 6 integer digits and 4 decimals. */
export const RATE = /^\d{1,6}(\.\d{1,4})?$/;
const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UpdatePlatformTelephonyDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ enum: TELEPHONY_MODES })
  @IsOptional()
  @IsIn(TELEPHONY_MODES)
  mode?: 'MOCK' | 'KUAIMA';
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyId?: string;
  /** Blank keeps the saved secret; it is never read back. */
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  appSecret?: string;
  @ApiPropertyOptional({ example: '0.1500' })
  @IsOptional()
  @IsString()
  @Matches(RATE)
  costPerMinute?: string;
  @ApiPropertyOptional({ example: '10.00' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  seatMonthlyCost?: string;
}
export class PlatformTelephonyResponseDto {
  @ApiProperty() version!: number;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() companyId!: string;
  @ApiProperty() hasAppSecret!: boolean;
  @ApiProperty() hasCallbackToken!: boolean;
  /** The callback URL without its credential, for display. */
  @ApiProperty() callbackEndpoint!: string;
  /** The server switch for real supplier calls (TELEPHONY_LIVE_ENABLED). */
  @ApiProperty() liveEnabled!: boolean;
  /** False in production, where the simulated line is forbidden. */
  @ApiProperty() mockAllowed!: boolean;
  @ApiProperty({ example: '0.1500' }) costPerMinute!: string;
  @ApiProperty({ example: '10.00' }) seatMonthlyCost!: string;
  @ApiProperty() ready!: boolean;
  /** What keeps the line from dialing, in words for the platform admin. */
  @ApiProperty({ type: [String] }) problems!: string[];
  /** Real supplier seats created across all companies. */
  @ApiProperty() seats!: number;
}
export class PlatformTelephonyTokenResponseDto {
  @ApiProperty({ type: PlatformTelephonyResponseDto })
  settings!: PlatformTelephonyResponseDto;
  /** Shown once: the full URL to give the supplier, credential included. */
  @ApiProperty() callbackUrl!: string;
}
export class TelephonyPlanInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/\S/)
  name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10_000) seats!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000_000) monthlyMinutes!: number;
  @ApiProperty({ example: '120.00' })
  @IsString()
  @Matches(MONEY)
  monthlyPrice!: string;
  @ApiProperty() @IsBoolean() assignable!: boolean;
}
export class UpdateTelephonyPlanDto extends TelephonyPlanInputDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
export class TelephonyPlanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() seats!: number;
  @ApiProperty() monthlyMinutes!: number;
  @ApiProperty({ example: '120.00' }) monthlyPrice!: string;
  @ApiProperty() assignable!: boolean;
  @ApiProperty() version!: number;
  /** Companies on this plan now. */
  @ApiProperty() companies!: number;
}
export class TelephonyPlanVersionQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}
export class TelephonyMinuteAdditionDto {
  @ApiProperty() month!: string;
  @ApiProperty() minutes!: number;
  @ApiProperty() price!: string;
  @ApiProperty() note!: string;
  @ApiProperty() createdAt!: string;
}
export class PlatformTenantTelephonyResponseDto {
  @ApiProperty() tenantId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) planId!: string | null;
  @ApiProperty({ type: String, nullable: true }) planName!: string | null;
  @ApiProperty() seats!: number;
  @ApiProperty() monthlyMinutes!: number;
  @ApiProperty() month!: string;
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() extraMinutes!: number;
  @ApiProperty() allowance!: number;
  @ApiProperty() seatsEnabled!: number;
  @ApiProperty({ type: [TelephonyMinuteAdditionDto] })
  additions!: TelephonyMinuteAdditionDto[];
}
export class AssignTelephonyPlanDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  /** Null sets the company back to 未开通. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  planId!: string | null;
}
export class AddTelephonyMinutesDto {
  @ApiProperty({ example: '2026-11-01' }) @Matches(MONTH_START) month!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) minutes!: number;
  @ApiProperty({ example: '30.00' }) @IsString() @Matches(MONEY) price!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{8,100}$/) idempotencyKey!: string;
}
export class AddTelephonyMinutesResponseDto {
  @ApiProperty() applied!: boolean;
  @ApiProperty() month!: string;
}
export class TelephonyReportQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(MONTH) month!: string;
}
export class TelephonyReportRowDto {
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ type: String, nullable: true }) planName!: string | null;
  @ApiProperty() monthlyMinutes!: number;
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() extraMinutes!: number;
  @ApiProperty() allowance!: number;
  @ApiProperty() planPrice!: string;
  @ApiProperty() extraPrice!: string;
  @ApiProperty() revenue!: string;
  @ApiProperty() minuteCost!: string;
  @ApiProperty() seatCost!: string;
  @ApiProperty() cost!: string;
  @ApiProperty() margin!: string;
  @ApiProperty() seatsProvisioned!: number;
}
export class TelephonyReportTotalDto {
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() revenue!: string;
  @ApiProperty() cost!: string;
  @ApiProperty() margin!: string;
}
export class TelephonyReportResponseDto {
  @ApiProperty() month!: string;
  /** Seat cost uses the current monthly seat price; it is not kept per month. */
  @ApiProperty() seatMonthlyCost!: string;
  @ApiProperty({ type: [TelephonyReportRowDto] }) rows!: TelephonyReportRowDto[];
  @ApiProperty({ type: TelephonyReportTotalDto }) total!: TelephonyReportTotalDto;
}
```

- [ ] **Step 7: 写平台服务**

`telephony-platform.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import type { AuditEvent } from '../../audit/audit-event';
import { AuditService } from '../../audit/audit.service';
import {
  allowance,
  readUsage,
  TelephonyLine,
  type LineMode,
} from './telephony-line';
import type {
  AddTelephonyMinutesDto,
  AssignTelephonyPlanDto,
  PlatformTelephonyResponseDto,
  PlatformTenantTelephonyResponseDto,
  TelephonyPlanInputDto,
  TelephonyPlanResponseDto,
  TelephonyReportResponseDto,
  UpdatePlatformTelephonyDto,
  UpdateTelephonyPlanDto,
} from './telephony-platform.dto';

type Tx = Prisma.TransactionClient;
export type AuditMeta = { requestId: string; ip?: string };
const withCompanies = { _count: { select: { configs: true } } } as const;
type PlanRow = Prisma.TelephonyPlanGetPayload<{ include: typeof withCompanies }>;
type Plan = Prisma.TelephonyPlanGetPayload<Record<string, never>>;
type Money = Prisma.Decimal | string;

function conflict(
  message = '数据刚被修改，请刷新后重试。',
  fieldErrors?: Record<string, string[]>,
): never {
  throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
  });
}
const day = (value: Date) => value.toISOString().slice(0, 10);
const planView = (plan: PlanRow): TelephonyPlanResponseDto => ({
  id: plan.id,
  name: plan.name,
  seats: plan.seats,
  monthlyMinutes: plan.monthlyMinutes,
  monthlyPrice: plan.monthlyPrice.toFixed(2),
  assignable: plan.assignable,
  version: plan.version,
  companies: plan._count.configs,
});
const planAudit = (plan: Plan) => ({
  name: plan.name,
  seats: plan.seats,
  monthlyMinutes: plan.monthlyMinutes,
  monthlyPrice: plan.monthlyPrice.toFixed(2),
  assignable: plan.assignable,
});

/** The platform's side of calling: the line, plans, companies and the books. */
@Injectable()
export class TelephonyPlatformService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
    private readonly line: TelephonyLine,
  ) {}

  /** Platform writes take the line row first, so they never interleave. */
  private write<T>(
    user: string,
    work: (tx: Tx) => Promise<T>,
    invalid = '请求与当前数据不一致，请刷新后重试。',
  ): Promise<T> {
    return this.runner
      .withUser(user, async (tx) => {
        await tx.$queryRaw`SELECT id FROM telephony_platform_settings WHERE id FOR UPDATE`;
        return work(tx);
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002')
            conflict('套餐名称已被使用。', { name: ['DUPLICATE'] });
          if (error.code === 'P2003')
            conflict('套餐正在使用，不能删除；可以改为停止分配。');
          if (error.code === 'P2010') {
            const adapter = error.meta?.driverAdapterError as
              | { cause?: { originalCode?: string } }
              | undefined;
            const code = adapter?.cause?.originalCode ?? error.meta?.code;
            if (code === '23505') conflict('套餐名称已被使用。');
            if (code === '23514')
              conflict('坐席数少于公司已开的坐席，请刷新后重试。', {
                seats: ['TELEPHONY_SEATS_EXCEEDED'],
              });
            if (code === '22023') conflict(invalid);
          }
        }
        throw error;
      });
  }
  private log(
    tx: Tx,
    user: string,
    meta: AuditMeta,
    event: Pick<
      AuditEvent,
      'action' | 'resourceType' | 'resourceId' | 'tenantId' | 'before' | 'after'
    >,
  ) {
    return this.audit.append(tx, {
      ...meta,
      ...event,
      actorType: 'USER',
      actorId: user,
    });
  }

  private async lineView(tx: Tx): Promise<PlatformTelephonyResponseDto> {
    const row = await tx.telephonyPlatformSettings.findUniqueOrThrow({
      where: { id: true },
    });
    const mode = row.mode as LineMode;
    const problems = this.line.problems({
      mode,
      companyId: row.companyId,
      appSecretEncrypted: row.appSecretEncrypted,
      callbackTokenEncrypted: row.callbackTokenEncrypted,
    });
    const [{ seats }] = await tx.$queryRaw<
      Array<{ seats: number }>
    >`SELECT telephony_platform_seats() AS seats`;
    return {
      version: row.version,
      mode,
      companyId: row.companyId,
      hasAppSecret: Boolean(row.appSecretEncrypted),
      hasCallbackToken: Boolean(row.callbackTokenEncrypted),
      callbackEndpoint: this.line.callbackEndpoint(),
      liveEnabled: this.line.liveEnabled(),
      mockAllowed: !this.line.production(),
      costPerMinute: row.costPerMinute.toFixed(4),
      seatMonthlyCost: row.seatMonthlyCost.toFixed(2),
      ready: problems.length === 0,
      problems,
      seats,
    };
  }

  lineSettings(user: string) {
    return this.runner.withUser(user, (tx) => this.lineView(tx));
  }

  updateLine(user: string, input: UpdatePlatformTelephonyDto, meta: AuditMeta) {
    if (input.mode === 'MOCK' && this.line.production())
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '正式环境不能用模拟线路。',
      });
    return this.write(user, async (tx) => {
      const current = await tx.telephonyPlatformSettings.findUniqueOrThrow({
        where: { id: true },
      });
      if (current.version !== input.version)
        conflict('线路设置刚被修改，请刷新后重试。');
      const appSecret = input.appSecret?.trim();
      const saved = await tx.telephonyPlatformSettings.update({
        where: { id: true },
        data: {
          version: { increment: 1 },
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.companyId !== undefined
            ? { companyId: input.companyId.trim() }
            : {}),
          // A blank secret keeps the saved one; it is never read back.
          ...(appSecret
            ? { appSecretEncrypted: this.line.vault.seal('appSecret', appSecret) }
            : {}),
          ...(input.costPerMinute !== undefined
            ? { costPerMinute: new Prisma.Decimal(input.costPerMinute) }
            : {}),
          ...(input.seatMonthlyCost !== undefined
            ? { seatMonthlyCost: new Prisma.Decimal(input.seatMonthlyCost) }
            : {}),
        },
      });
      const summary = (row: typeof current) => ({
        version: row.version,
        mode: row.mode,
        companyId: row.companyId,
        costPerMinute: row.costPerMinute.toFixed(4),
        seatMonthlyCost: row.seatMonthlyCost.toFixed(2),
      });
      await this.log(tx, user, meta, {
        action: 'telephony.line_updated',
        resourceType: 'telephony_platform_settings',
        before: summary(current),
        after: { ...summary(saved), appSecretChanged: Boolean(appSecret) },
      });
      return this.lineView(tx);
    });
  }

  /**
   * Issues a new callback credential. The full URL is returned this once for
   * the platform admin to hand to the supplier; afterwards only "set" shows.
   */
  rotateCallbackToken(user: string, meta: AuditMeta) {
    const token = randomBytes(24).toString('base64url');
    return this.write(user, async (tx) => {
      // The line form never writes this column, so issuing a credential does
      // not bump the form's version or conflict with an open edit.
      await tx.telephonyPlatformSettings.update({
        where: { id: true },
        data: {
          callbackTokenEncrypted: this.line.vault.seal('callbackToken', token),
        },
      });
      await this.log(tx, user, meta, {
        action: 'telephony.callback_token_rotated',
        resourceType: 'telephony_platform_settings',
      });
      return {
        settings: await this.lineView(tx),
        callbackUrl: `${this.line.callbackEndpoint()}?token=${token}`,
      };
    });
  }

  plans(user: string) {
    return this.runner.withUser(user, async (tx) =>
      (
        await tx.telephonyPlan.findMany({
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          include: withCompanies,
        })
      ).map(planView),
    );
  }

  createPlan(user: string, input: TelephonyPlanInputDto, meta: AuditMeta) {
    return this.write(user, async (tx) => {
      const plan = await tx.telephonyPlan.create({
        data: {
          name: input.name.trim(),
          seats: input.seats,
          monthlyMinutes: input.monthlyMinutes,
          monthlyPrice: new Prisma.Decimal(input.monthlyPrice),
          assignable: input.assignable,
        },
        include: withCompanies,
      });
      await this.log(tx, user, meta, {
        action: 'telephony.plan_created',
        resourceType: 'telephony_plan',
        resourceId: plan.id,
        after: planAudit(plan),
      });
      return planView(plan);
    });
  }

  updatePlan(
    user: string,
    id: string,
    input: UpdateTelephonyPlanDto,
    meta: AuditMeta,
  ) {
    return this.write(user, async (tx) => {
      const before = await tx.telephonyPlan.findUnique({ where: { id } });
      if (!before) throw new ApiException('RECORD_NOT_FOUND', 404);
      if (before.version !== input.version)
        conflict('套餐刚被修改，请刷新后重试。');
      if (input.seats < before.seats) {
        const overflow = await tx.$queryRaw<
          Array<{ tenant_name: string; seats_enabled: number }>
        >`SELECT tenant_name, seats_enabled FROM telephony_plan_overflow(${id}::uuid, ${input.seats}::int)`;
        if (overflow.length)
          conflict(
            `坐席数不能少于这些公司已开的坐席：${overflow
              .map((row) => `${row.tenant_name}（${row.seats_enabled} 个）`)
              .join('、')}。请先请公司管理员关掉部分成员的外呼。`,
            { seats: ['TELEPHONY_SEATS_EXCEEDED'] },
          );
      }
      const plan = await tx.telephonyPlan.update({
        where: { id },
        data: {
          name: input.name.trim(),
          seats: input.seats,
          monthlyMinutes: input.monthlyMinutes,
          monthlyPrice: new Prisma.Decimal(input.monthlyPrice),
          assignable: input.assignable,
          version: { increment: 1 },
        },
        include: withCompanies,
      });
      await this.log(tx, user, meta, {
        action: 'telephony.plan_updated',
        resourceType: 'telephony_plan',
        resourceId: id,
        before: planAudit(before),
        after: planAudit(plan),
      });
      return planView(plan);
    });
  }

  deletePlan(user: string, id: string, version: number, meta: AuditMeta) {
    return this.write(user, async (tx) => {
      const plan = await tx.telephonyPlan.findUnique({ where: { id } });
      if (!plan) throw new ApiException('RECORD_NOT_FOUND', 404);
      if (plan.version !== version) conflict('套餐刚被修改，请刷新后重试。');
      if (await tx.tenantTelephonyConfig.count({ where: { planId: id } }))
        conflict('套餐正在使用，不能删除；可以改为停止分配。');
      await tx.telephonyPlan.delete({ where: { id } });
      await this.log(tx, user, meta, {
        action: 'telephony.plan_deleted',
        resourceType: 'telephony_plan',
        resourceId: id,
        before: planAudit(plan),
      });
    });
  }

  private async companyView(
    tx: Tx,
    tenantId: string,
  ): Promise<PlatformTenantTelephonyResponseDto> {
    const usage = await readUsage(tx, tenantId);
    const config = await tx.tenantTelephonyConfig.findUnique({
      where: { tenantId },
    });
    const additions = await tx.telephonyMinuteAddition.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      tenantId,
      version: config?.version ?? 0,
      planId: usage.planId,
      planName: usage.planName,
      seats: usage.seats,
      monthlyMinutes: usage.monthlyMinutes,
      month: usage.month,
      usedMinutes: usage.usedMinutes,
      extraMinutes: usage.extraMinutes,
      allowance: allowance(usage),
      seatsEnabled: usage.seatsEnabled,
      additions: additions.map((entry) => ({
        month: day(entry.month),
        minutes: entry.minutes,
        price: entry.price.toFixed(2),
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  company(user: string, tenantId: string) {
    return this.runner.withUser(user, (tx) => this.companyView(tx, tenantId));
  }

  assign(
    user: string,
    tenantId: string,
    input: AssignTelephonyPlanDto,
    meta: AuditMeta,
  ) {
    const planId = input.planId ?? null;
    return this.write(user, async (tx) => {
      const before = await this.companyView(tx, tenantId);
      if (before.version !== input.version)
        conflict('通话服务刚被修改，请刷新后重试。');
      if (before.planId === planId) return before;
      if (planId) {
        const plan = await tx.telephonyPlan.findUnique({ where: { id: planId } });
        if (!plan?.assignable)
          throw new ApiException('VALIDATION_FAILED', 400, {
            message: '这个套餐不存在或已停止分配。',
            fieldErrors: { planId: ['PLAN_NOT_ASSIGNABLE'] },
          });
        if (before.seatsEnabled > plan.seats)
          conflict(
            `这家公司已开 ${before.seatsEnabled} 个坐席，「${plan.name}」只含 ${plan.seats} 个。请先请公司管理员关掉 ${before.seatsEnabled - plan.seats} 位成员的外呼。`,
            { planId: ['TELEPHONY_SEATS_EXCEEDED'] },
          );
      }
      const [{ ok }] = await tx.$queryRaw<
        Array<{ ok: boolean }>
      >`SELECT telephony_assign_plan(${tenantId}::uuid, ${planId}::uuid, ${input.version}::int) AS ok`;
      if (!ok) conflict('通话服务刚被修改，请刷新后重试。');
      await this.log(tx, user, meta, {
        action: 'telephony.plan_assigned',
        resourceType: 'tenant_telephony_config',
        resourceId: tenantId,
        tenantId,
        before: { planId: before.planId },
        after: { planId },
      });
      return this.companyView(tx, tenantId);
    });
  }

  addMinutes(
    user: string,
    tenantId: string,
    input: AddTelephonyMinutesDto,
    meta: AuditMeta,
  ) {
    const note = input.note?.trim() ?? '';
    return this.write(
      user,
      async (tx) => {
        const [{ applied }] = await tx.$queryRaw<
          Array<{ applied: boolean }>
        >`SELECT telephony_add_minutes(${tenantId}::uuid, ${input.month}::date, ${input.minutes}::int, ${input.price}::numeric, ${note}, ${input.idempotencyKey}) AS applied`;
        if (applied)
          await this.log(tx, user, meta, {
            action: 'telephony.minutes_added',
            resourceType: 'telephony_minute_addition',
            resourceId: tenantId,
            tenantId,
            after: {
              month: input.month,
              minutes: input.minutes,
              price: input.price,
              note,
            },
          });
        return { applied, month: input.month };
      },
      '只能给公司的当月加分钟；同一次加量不能改分钟数或收费。',
    );
  }

  report(user: string, month: string): Promise<TelephonyReportResponseDto> {
    return this.runner.withUser(user, async (tx) => {
      const line = await tx.telephonyPlatformSettings.findUniqueOrThrow({
        where: { id: true },
      });
      const rows = await tx.$queryRaw<
        Array<{
          tenant_id: string;
          tenant_name: string;
          plan_name: string | null;
          monthly_price: Money;
          monthly_minutes: number;
          used_minutes: number;
          extra_minutes: number;
          extra_price: Money;
          minute_cost: Money;
          seats_provisioned: number;
        }>
      >`SELECT tenant_id::text AS tenant_id, tenant_name, plan_name, monthly_price, monthly_minutes, used_minutes, extra_minutes, extra_price, minute_cost, seats_provisioned FROM telephony_report(${`${month}-01`}::date)`;
      let usedMinutes = 0;
      let revenueTotal = new Prisma.Decimal(0);
      let costTotal = new Prisma.Decimal(0);
      const out = rows.map((row) => {
        const planPrice = new Prisma.Decimal(row.monthly_price);
        const extraPrice = new Prisma.Decimal(row.extra_price);
        const minuteCost = new Prisma.Decimal(row.minute_cost);
        const seatCost = line.seatMonthlyCost.times(row.seats_provisioned);
        const revenue = planPrice.plus(extraPrice);
        const cost = minuteCost.plus(seatCost);
        usedMinutes += row.used_minutes;
        revenueTotal = revenueTotal.plus(revenue);
        costTotal = costTotal.plus(cost);
        return {
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          planName: row.plan_name,
          monthlyMinutes: row.monthly_minutes,
          usedMinutes: row.used_minutes,
          extraMinutes: row.extra_minutes,
          allowance: row.monthly_minutes + row.extra_minutes,
          planPrice: planPrice.toFixed(2),
          extraPrice: extraPrice.toFixed(2),
          revenue: revenue.toFixed(2),
          minuteCost: minuteCost.toFixed(2),
          seatCost: seatCost.toFixed(2),
          cost: cost.toFixed(2),
          margin: revenue.minus(cost).toFixed(2),
          seatsProvisioned: row.seats_provisioned,
        };
      });
      return {
        month,
        seatMonthlyCost: line.seatMonthlyCost.toFixed(2),
        rows: out,
        total: {
          usedMinutes,
          revenue: revenueTotal.toFixed(2),
          cost: costTotal.toFixed(2),
          margin: revenueTotal.minus(costTotal).toFixed(2),
        },
      };
    });
  }
}
```

- [ ] **Step 8: 写平台控制器并注册**

`telephony-platform.controller.ts`：

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentSession } from '../../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import type { SessionPrincipal } from '../../auth/session.service';
import {
  AddTelephonyMinutesDto,
  AddTelephonyMinutesResponseDto,
  AssignTelephonyPlanDto,
  PlatformTelephonyResponseDto,
  PlatformTelephonyTokenResponseDto,
  PlatformTenantTelephonyResponseDto,
  TelephonyPlanInputDto,
  TelephonyPlanResponseDto,
  TelephonyPlanVersionQueryDto,
  TelephonyReportQueryDto,
  TelephonyReportResponseDto,
  UpdatePlatformTelephonyDto,
  UpdateTelephonyPlanDto,
} from './telephony-platform.dto';
import {
  TelephonyPlatformService,
  type AuditMeta,
} from './telephony-platform.service';

type RequestWithId = Request & { requestId?: string };
const meta = (req: RequestWithId): AuditMeta => ({
  requestId: req.requestId ?? 'req_unknown',
  ip: req.ip,
});

@Controller('platform')
@ApiTags('platform-telephony')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class TelephonyPlatformController {
  constructor(private readonly service: TelephonyPlatformService) {}

  @Get('telephony-settings')
  @ApiOkResponse({ type: PlatformTelephonyResponseDto })
  line(@CurrentSession() session: SessionPrincipal) {
    return this.service.lineSettings(session.user.id);
  }
  @Patch('telephony-settings')
  @ApiOkResponse({ type: PlatformTelephonyResponseDto })
  updateLine(
    @CurrentSession() session: SessionPrincipal,
    @Body() input: UpdatePlatformTelephonyDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.updateLine(session.user.id, input, meta(req));
  }
  @Post('telephony-settings/callback-token')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformTelephonyTokenResponseDto })
  rotateCallbackToken(
    @CurrentSession() session: SessionPrincipal,
    @Req() req: RequestWithId,
  ) {
    return this.service.rotateCallbackToken(session.user.id, meta(req));
  }
  @Get('telephony-plans')
  @ApiOkResponse({ type: [TelephonyPlanResponseDto] })
  plans(@CurrentSession() session: SessionPrincipal) {
    return this.service.plans(session.user.id);
  }
  @Post('telephony-plans')
  @ApiCreatedResponse({ type: TelephonyPlanResponseDto })
  createPlan(
    @CurrentSession() session: SessionPrincipal,
    @Body() input: TelephonyPlanInputDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.createPlan(session.user.id, input, meta(req));
  }
  @Patch('telephony-plans/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TelephonyPlanResponseDto })
  updatePlan(
    @CurrentSession() session: SessionPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateTelephonyPlanDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.updatePlan(session.user.id, id, input, meta(req));
  }
  @Delete('telephony-plans/:id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  async deletePlan(
    @CurrentSession() session: SessionPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TelephonyPlanVersionQueryDto,
    @Req() req: RequestWithId,
  ) {
    await this.service.deletePlan(session.user.id, id, query.version, meta(req));
  }
  @Get('tenants/:tenantId/telephony')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: PlatformTenantTelephonyResponseDto })
  company(
    @CurrentSession() session: SessionPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.service.company(session.user.id, tenantId);
  }
  @Patch('tenants/:tenantId/telephony')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: PlatformTenantTelephonyResponseDto })
  assign(
    @CurrentSession() session: SessionPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() input: AssignTelephonyPlanDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.assign(session.user.id, tenantId, input, meta(req));
  }
  @Post('tenants/:tenantId/telephony/minutes')
  @HttpCode(200)
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({ type: AddTelephonyMinutesResponseDto })
  addMinutes(
    @CurrentSession() session: SessionPrincipal,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() input: AddTelephonyMinutesDto,
    @Req() req: RequestWithId,
  ) {
    return this.service.addMinutes(session.user.id, tenantId, input, meta(req));
  }
  @Get('telephony-report')
  @ApiOkResponse({ type: TelephonyReportResponseDto })
  report(
    @CurrentSession() session: SessionPrincipal,
    @Query() query: TelephonyReportQueryDto,
  ) {
    return this.service.report(session.user.id, query.month);
  }
}
```

`integrations.module.ts` 加：

```ts
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { TelephonyPlatformController } from './telephony/telephony-platform.controller';
import { TelephonyPlatformService } from './telephony/telephony-platform.service';
```

`controllers` 末尾加 `TelephonyPlatformController`；`providers` 末尾加 `TelephonyPlatformService, PlatformAdminGuard`。

- [ ] **Step 9: 跑两套端到端测试**

Run: `.local/telephony/run-e2e.sh test/platform-telephony.e2e-spec.ts test/telephony.e2e-spec.ts`
Expected: 两个文件全部 PASS（平台 9 个测试；公司侧原有测试数不变）。如果有失败，先看是不是 Step 3 的某一处没改到。

- [ ] **Step 10: 类型检查和 lint**

Run: `pnpm --filter @crm/api typecheck && pnpm --filter @crm/api lint`
Expected: 无错误。

- [ ] **Step 11: 提交**

```bash
git add apps/api/src/modules/integrations apps/api/test/helpers/telephony-fixture.ts apps/api/test/platform-telephony.e2e-spec.ts apps/api/test/telephony.e2e-spec.ts apps/api/package.json
git commit -m "$(cat <<'EOF'
平台电话外呼接口：线路、通话套餐、开通、加分钟、收支，含端到端测试

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 通话额度提醒

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.dto.ts:16-25`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`（`QUOTA` 约第 41 行、`COPY` 约第 53 行、`target()` 约第 182 行）
- Test: `apps/api/test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 触发器写入的 `TELEPHONY_MINUTES_80` / `TELEPHONY_MINUTES_100` 通知。
- Produces: 通知列表里这两种的标题和说明；打开目标为 `/workspace/{code}/settings/telephony`。

- [ ] **Step 1: 写失败的测试**

在 `notifications.e2e-spec.ts` 的 `shows quota alerts to their admin recipient and opens AI settings` 后面加：

```ts
  it('shows calling-minute alerts to their admin recipient and opens telephony settings', async () => {
    await h.adminDatabase.$executeRaw`
      INSERT INTO member_notifications(tenant_id,recipient_member_id,kind,event_key)
      VALUES (${f.tenantA.id}::uuid,${f.admin.memberId}::uuid,'TELEPHONY_MINUTES_80','2026-11-01'),
             (${f.tenantA.id}::uuid,${f.admin.memberId}::uuid,'TELEPHONY_MINUTES_100','2026-11-01')`;
    const alerts = json<Inbox>(await get('', f.admin).expect(200)).items;
    expect(alerts.map(item => item.title).sort()).toEqual(['本月通话分钟已用到 80%','本月通话分钟已用完']);
    for (const item of alerts) {
      expect(item.canOpen).toBe(true);
      expect((await get('/'+item.id+'/target',f.admin).expect(200)).body.href)
        .toBe('/workspace/'+f.tenantA.code+'/settings/telephony');
      await get('/'+item.id+'/target',f.employee).expect(404);
    }
    expect((await inbox()).items).toHaveLength(0);
  });
```

（`cleanNotifications()` 已按公司删掉全部通知，不用改。）

- [ ] **Step 2: 确认测试失败**

Run: `.local/telephony/run-e2e.sh test/notifications.e2e-spec.ts -t "calling-minute"`
Expected: FAIL——这两种通知不在可见范围里，列表为空（或因 `COPY` 没有这两种而 500）。

- [ ] **Step 3: 实现**

`notifications.dto.ts` 的 `NOTIFICATION_KINDS` 末尾加 `'TELEPHONY_MINUTES_80', 'TELEPHONY_MINUTES_100',`。

`notifications.service.ts`：

```ts
const QUOTA =
  "(n.kind IN ('AI_QUOTA_80','AI_QUOTA_100','TELEPHONY_MINUTES_80','TELEPHONY_MINUTES_100') AND EXISTS (SELECT 1 FROM tenant_members admin WHERE admin.tenant_id=n.tenant_id AND admin.id=n.recipient_member_id AND admin.role='TENANT_ADMIN'))";
```

`COPY` 里加：

```ts
  TELEPHONY_MINUTES_80: ['本月通话分钟已用到 80%', '可在电话外呼设置查看用量'],
  TELEPHONY_MINUTES_100: ['本月通话分钟已用完', '如需加量，请联系平台管理员'],
```

`target()` 里 AI 那一段后面加：

```ts
    if (row.kind === 'TELEPHONY_MINUTES_80' || row.kind === 'TELEPHONY_MINUTES_100')
      return {
        href: `/workspace/${encodeURIComponent(context.tenantCode)}/settings/telephony`,
      };
```

- [ ] **Step 4: 确认测试通过**

Run: `.local/telephony/run-e2e.sh test/notifications.e2e-spec.ts test/platform-telephony.e2e-spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/notifications apps/api/test/notifications.e2e-spec.ts
git commit -m "$(cat <<'EOF'
通话分钟用到 80% 和 100% 时提醒公司管理员

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 更新接口契约

**Files:**
- Modify: `packages/contracts/openapi.json`、`packages/contracts/src/generated/openapi.ts`（生成）

**Interfaces:**
- Produces: 网页用的 `components["schemas"]` 新类型：`PlatformTelephonyResponseDto`、`UpdatePlatformTelephonyDto`、`PlatformTelephonyTokenResponseDto`、`TelephonyPlanInputDto`、`UpdateTelephonyPlanDto`、`TelephonyPlanResponseDto`、`PlatformTenantTelephonyResponseDto`、`AssignTelephonyPlanDto`、`AddTelephonyMinutesDto`、`TelephonyReportResponseDto`、`TelephonyReportRowDto`；改过的 `TelephonySettingsResponseDto`、`TelephonyBindingResponseDto`、`TelephonyRuntimeResponseDto`、`UpdateTelephonySettingsDto`、`UpdateTelephonyBindingDto`。

- [ ] **Step 1: 生成**

Run: `pnpm contracts:generate && pnpm --filter @crm/contracts build`
Expected: 两个生成文件有变化；`git diff --stat packages/contracts` 只涉及这两个文件。如果 prettier 顺带改了别的文件，用 `git checkout -- <文件>` 还原，只留这两个文件。

- [ ] **Step 2: 确认网页类型检查暴露出要改的地方**

Run: `pnpm --filter @crm/web typecheck`
Expected: FAIL，错误集中在 `features/telephony/telephony-settings.tsx`、`call-dialog.test.tsx`（`lineStatus`、`seatId`、`enabled`、`mode` 等字段已不存在）和 `settings/page.tsx`。这些在 Task 8 修；Task 8 结束时网页类型检查应当全部通过。

- [ ] **Step 3: 提交**

```bash
git add packages/contracts/openapi.json packages/contracts/src/generated/openapi.ts
git commit -m "$(cat <<'EOF'
接口契约：平台电话线路、通话套餐、开通和收支

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 公司侧网页——设置页三块、四种原因、入口显隐、提醒文案

**Files:**
- Modify: `apps/web/src/features/telephony/telephony-api.ts`
- Rewrite: `apps/web/src/features/telephony/telephony-settings.tsx`
- Modify: `apps/web/src/features/telephony/telephony.module.css`
- Create: `apps/web/src/features/telephony/telephony-settings.test.tsx`
- Modify: `apps/web/src/features/telephony/call-dialog.test.tsx`
- Modify: `apps/web/src/components/navigation/workspace-navigation.ts`
- Modify: `apps/web/src/components/layout/workspace-shell.tsx`、`workspace-shell.test.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/layout.tsx`
- Modify: `apps/web/src/app/(workspace)/workspace/[tenantCode]/settings/page.tsx`
- Modify: `apps/web/src/features/settings/settings-overview.tsx`
- Modify: `apps/web/src/features/records/record-detail-page.tsx:192`
- Modify: `apps/web/src/features/notifications/notification-bell.tsx`
- Modify: `apps/web/src/features/platform/audit-labels.ts`、`audit-labels.test.ts`

**Interfaces:**
- Consumes: Task 7 生成的类型。`TelephonySettings = { version, phoneFields, plan: { name, seats, monthlyMinutes } | null, usage: { month, usedMinutes, extraMinutes, allowance, seatsEnabled }, lineReady }`；`TelephonyBinding = { memberId, displayName, status, version, enabled, phone, seatStatus: 'NONE' | 'READY' | 'FAILED', seatError }`；`TelephonyRuntime` 多了 `hasHistory`，`reason` 只有四种。
- Produces:
  - `serviceStatus(settings): { label: string; tone: StatusTone }`（`telephony-settings.tsx`）。
  - `workspaceSettingsNavigation(tenantCode, { telephony?: boolean })`：默认 **不** 含「电话外呼」，只有 `telephony: true` 才列出；空分组不返回。
  - `WorkspaceShell` 新增 `telephony?: boolean`。
  - `UNAVAILABLE_REASON` 只有 `NOT_ENABLED`、`PLATFORM_NOT_READY`、`MINUTES_EXHAUSTED`、`MEMBER_NOT_CONFIGURED` 四项。

- [ ] **Step 1: 写失败的测试**

新建 `apps/web/src/features/telephony/telephony-settings.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { objectApi } from "@/features/objects/object-api";

import {
  telephonyApi,
  type TelephonyBinding,
  type TelephonySettings,
} from "./telephony-api";
import { TelephonySettingsPage } from "./telephony-settings";

const settings: TelephonySettings = {
  version: 2,
  phoneFields: [],
  plan: { name: "标准版", seats: 3, monthlyMinutes: 100 },
  usage: {
    month: "2026-11-01",
    usedMinutes: 12,
    extraMinutes: 30,
    allowance: 130,
    seatsEnabled: 1,
  },
  lineReady: true,
};
const member = (overrides: Partial<TelephonyBinding>): TelephonyBinding => ({
  memberId: "m1",
  displayName: "孙悦",
  status: "ACTIVE",
  version: 1,
  enabled: false,
  phone: "",
  seatStatus: "NONE",
  seatError: null,
  ...overrides,
});

function show(value: TelephonySettings) {
  vi.spyOn(telephonyApi, "settings").mockResolvedValue(value);
  vi.spyOn(telephonyApi, "members").mockResolvedValue({
    members: [
      member({ enabled: true, phone: "13911113002", seatStatus: "READY" }),
      member({
        memberId: "m2",
        displayName: "李雷",
        phone: "13911113003",
        seatStatus: "FAILED",
        seatError: "手机号已被其他坐席使用",
      }),
      member({ memberId: "m3", displayName: "韩梅" }),
    ],
  });
  vi.spyOn(objectApi, "listAccessible").mockResolvedValue([]);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TelephonySettingsPage tenantCode="nebula" memberId="admin" />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.restoreAllMocks());

describe("company telephony settings", () => {
  it("shows the plan and this month's use, the dialable fields and each member's seat, without money", async () => {
    show(settings);
    expect(await screen.findByText("标准版")).toBeTruthy();
    expect(screen.getByText("12 / 130 分钟")).toBeTruthy();
    for (const title of ["套餐和用量", "可拨打的号码", "成员坐席"])
      expect(screen.getByText(title)).toBeTruthy();
    expect(await screen.findByText("已建坐席 · 139 1111 3002")).toBeTruthy();
    expect(
      screen.getByText("建坐席失败：手机号已被其他坐席使用"),
    ).toBeTruthy();
    expect(screen.getByText("未建坐席")).toBeTruthy();
    expect(screen.queryAllByText(/¥|元|企业密钥|回调地址|坐席号/)).toHaveLength(0);
  });

  it("explains that the platform has not opened calling yet", async () => {
    show({
      ...settings,
      plan: null,
      usage: { ...settings.usage, usedMinutes: 0, extraMinutes: 0, allowance: 0, seatsEnabled: 0 },
    });
    expect(await screen.findByText("电话外呼未开通")).toBeTruthy();
    expect(screen.queryByText("成员坐席")).toBeNull();
    expect(telephonyApi.members).not.toHaveBeenCalled();
  });

  it("says when the platform line is down", async () => {
    show({ ...settings, lineReady: false });
    expect(await screen.findAllByText("平台线路未就绪")).not.toHaveLength(0);
  });
});
```

改 `call-dialog.test.tsx`：

1. `import { lineStatus } from "./telephony-settings";` 改成 `import { serviceStatus } from "./telephony-settings";`；从 `./telephony-api` 的 import 里加上 `UNAVAILABLE_REASON`。
2. 顶部 `runtime` 对象在 `enabled: true,` 后面加一行 `hasHistory: false,`。
3. 在 `says why calling is off instead of offering the button` 后面加：

```tsx
  it("says the month's minutes are used up", async () => {
    show({ available: false, reason: "MINUTES_EXHAUSTED" });
    expect(
      await screen.findByText("本月通话分钟已用完，请联系管理员"),
    ).toBeTruthy();
  });
```

4. 整个 `names where the company line stands` 测试换成：

```tsx
  it("names where the company's calling stands", () => {
    const base = {
      plan: { name: "标准版", seats: 3, monthlyMinutes: 100 },
      lineReady: true,
      usage: {
        month: "2026-11-01",
        usedMinutes: 20,
        extraMinutes: 0,
        allowance: 100,
        seatsEnabled: 1,
      },
    };
    expect(serviceStatus({ ...base, plan: null }).label).toBe("未开通");
    expect(serviceStatus({ ...base, lineReady: false }).label).toBe(
      "平台线路未就绪",
    );
    expect(
      serviceStatus({ ...base, usage: { ...base.usage, usedMinutes: 100 } }),
    ).toEqual({ label: "本月分钟已用完", tone: "danger" });
    expect(serviceStatus(base)).toEqual({ label: "已开通", tone: "success" });
  });

  it("names each reason calling is off in words an employee can act on", () => {
    expect(UNAVAILABLE_REASON).toEqual({
      NOT_ENABLED: "公司未开通电话外呼",
      PLATFORM_NOT_READY: "通话线路暂不可用，请联系管理员",
      MINUTES_EXHAUSTED: "本月通话分钟已用完，请联系管理员",
      MEMBER_NOT_CONFIGURED: "你还没有外呼坐席，请联系管理员",
    });
  });
```

改 `workspace-shell.test.tsx`：

1. import 加 `workspaceSettingsNavigation`。
2. `keeps management destinations for company administrators` 的期望列表里删掉 `"/workspace/northwind/settings/telephony",` 这一行（默认不列出）。
3. 在 `lists the call log only once the company has calling on` 后面加：

```tsx
  it("lists 电话外呼 in settings only once the platform has opened calling", () => {
    const hrefs = (telephony: boolean) =>
      workspaceSettingsNavigation("northwind", { telephony }).flatMap((group) =>
        group.items.map((item) => item.href),
      );
    expect(hrefs(false)).not.toContain("/workspace/northwind/settings/telephony");
    expect(hrefs(true)).toContain("/workspace/northwind/settings/telephony");
    // An empty group is not shown at all.
    expect(
      workspaceSettingsNavigation("northwind").map((group) => group.label),
    ).not.toContain("集成");
  });
```

改 `apps/web/src/features/platform/audit-labels.test.ts`，在第一个测试里加：

```ts
  expect(actionLabel("telephony.minutes_added")).toBe("增加本月通话分钟");
  expect(actionLabel("telephony.plan_assigned")).toBe("更换公司通话套餐");
  expect(resourceLabel("telephony_plan")).toBe("通话套餐");
```

- [ ] **Step 2: 确认测试失败**

Run: `pnpm --filter @crm/web exec vitest run src/features/telephony src/components/layout/workspace-shell.test.tsx src/features/platform/audit-labels.test.ts`
Expected: FAIL——`serviceStatus` 不存在，设置页还在读 `enabled`/`seatId`，导航仍默认列出电话外呼，审计文案缺失。

- [ ] **Step 3: 改 `telephony-api.ts`**

删掉整个 `rotateCallbackToken` 方法；把 `UNAVAILABLE_REASON` 换成：

```ts
/** Why the current member cannot dial, in one short line. */
export const UNAVAILABLE_REASON: Record<string, string> = {
  NOT_ENABLED: "公司未开通电话外呼",
  PLATFORM_NOT_READY: "通话线路暂不可用，请联系管理员",
  MINUTES_EXHAUSTED: "本月通话分钟已用完，请联系管理员",
  MEMBER_NOT_CONFIGURED: "你还没有外呼坐席，请联系管理员",
};
```

- [ ] **Step 4: 重写公司设置页**

`apps/web/src/features/telephony/telephony-settings.tsx` 整个换成：

```tsx
"use client";

import {
  Alert,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Skeleton,
  Switch,
  Tooltip,
} from "antd";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import { Page, PageSection, SettingRow } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/components/feedback/use-toast";
import { StatePanel } from "@/components/workbench/state-panel";
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { objectApi } from "@/features/objects/object-api";
import { toApiError } from "@/lib/api/api-error";

import {
  dialable,
  formatPhone,
  telephonyApi,
  type TelephonyBinding,
  type TelephonySettings,
  type TelephonySettingsInput,
} from "./telephony-api";
import styles from "./telephony.module.css";

/** Where the company's calling stands, in two or three words. */
export function serviceStatus(
  settings: Pick<TelephonySettings, "plan" | "lineReady" | "usage">,
): { label: string; tone: StatusTone } {
  if (!settings.plan) return { label: "未开通", tone: "neutral" };
  if (!settings.lineReady) return { label: "平台线路未就绪", tone: "warning" };
  if (settings.usage.usedMinutes >= settings.usage.allowance)
    return { label: "本月分钟已用完", tone: "danger" };
  return { label: "已开通", tone: "success" };
}

/** A member's seat in a few words: whether the line made one and the phone it rings. */
function seatText(binding: TelephonyBinding) {
  if (binding.seatStatus === "FAILED")
    return `建坐席失败：${binding.seatError ?? "快马没有说明原因"}`;
  if (binding.seatStatus === "READY")
    return `已建坐席 · ${formatPhone(binding.phone)}`;
  return binding.phone ? `未建坐席 · ${formatPhone(binding.phone)}` : "未建坐席";
}

const PHONE_TYPES = new Set(["PHONE", "TEXT"]);

/**
 * Company outbound calling: the plan the platform assigned and this month's
 * use, which phone fields may be dialled, and who may call. The platform runs
 * the line and creates the seats; nothing here shows money or the account.
 */
export function TelephonySettingsPage({
  tenantCode,
  memberId,
}: {
  tenantCode: string;
  memberId: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const key = ["telephony-settings", tenantCode, memberId];
  const membersKey = ["telephony-members", tenantCode, memberId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => telephonyApi.settings(tenantCode),
  });
  const open = Boolean(settings.data?.plan);
  const members = useQuery({
    queryKey: membersKey,
    queryFn: () => telephonyApi.members(tenantCode),
    enabled: open,
  });
  const objects = useQuery({
    queryKey: ["objects-accessible", tenantCode, memberId],
    queryFn: () => objectApi.listAccessible(tenantCode),
    enabled: open,
  });
  const schemas = useQueries({
    queries: (objects.data ?? []).map((object) => ({
      queryKey: ["object-runtime-schema", tenantCode, object.code, memberId],
      queryFn: () => objectApi.runtimeSchema(tenantCode, object.code),
    })),
  });
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<TelephonyBinding>();

  const fail = (cause: unknown) => {
    const apiError = toApiError(cause);
    // A full seat list is a 409 too, but its message says what to do.
    setError(
      apiError.status === 409 && !apiError.fieldErrors.telephony
        ? "设置刚被其他管理员修改，已刷新为最新内容，请再试一次。"
        : apiError.message,
    );
    void settings.refetch();
  };
  const save = useMutation({
    mutationFn: (phoneFields: TelephonySettingsInput["phoneFields"]) =>
      telephonyApi.updateSettings(tenantCode, {
        version: settings.data?.version ?? 0,
        phoneFields,
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(key, result);
      void client.invalidateQueries({
        queryKey: ["telephony-runtime", tenantCode],
      });
      toast.success("已保存");
    },
    onError: fail,
  });
  const saveMember = useMutation({
    mutationFn: (binding: TelephonyBinding) =>
      telephonyApi.updateMember(tenantCode, binding.memberId, {
        version: binding.version,
        enabled: binding.enabled,
        phone: binding.phone.trim(),
      }),
    onMutate: () => setError(undefined),
    onSuccess: (result) => {
      client.setQueryData(
        membersKey,
        (current: { members: TelephonyBinding[] } | undefined) =>
          current && {
            members: current.members.map((entry) =>
              entry.memberId === result.memberId ? result : entry,
            ),
          },
      );
      // The seat count lives on the settings.
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({
        queryKey: ["telephony-runtime", tenantCode],
      });
      setEditing(undefined);
      toast.success("已保存");
    },
    onError: (cause) => {
      fail(cause);
      // A refused seat is saved with the supplier's reason.
      void members.refetch();
    },
  });

  const state = settings.data;
  if (settings.isError)
    return (
      <Page width="settings">
        <PageHeader title="电话外呼" />
        <LoadError
          error={settings.error}
          retry={() => void settings.refetch()}
        />
      </Page>
    );
  if (!state)
    return (
      <Page width="settings">
        <PageHeader title="电话外呼" />
        <Skeleton active />
      </Page>
    );

  const status = serviceStatus(state);
  const header = (
    <PageHeader
      title="电话外呼"
      status={<StatusTag tone={status.tone}>{status.label}</StatusTag>}
    />
  );
  if (!state.plan)
    return (
      <Page width="settings">
        {header}
        <StatePanel
          title="电话外呼未开通"
          description="需要平台管理员为公司开通通话套餐。开通后可以在这里给成员开外呼。"
        />
      </Page>
    );

  const plan = state.plan;
  const usage = state.usage;
  const percent = usage.allowance
    ? Math.min(100, Math.round((usage.usedMinutes / usage.allowance) * 100))
    : 100;
  const saved = new Map(
    state.phoneFields.map((entry) => [entry.objectCode, entry.fieldKeys]),
  );
  const phoneObjects = (objects.data ?? []).flatMap((object, index) => {
    const schema = schemas[index]?.data;
    if (!schema) return [];
    const fields = schema.fields
      .filter((field) => PHONE_TYPES.has(field.type))
      .sort((a, b) =>
        a.type === b.type
          ? a.sortOrder - b.sortOrder
          : a.type === "PHONE"
            ? -1
            : 1,
      );
    return fields.length
      ? [{ code: object.code, name: object.name, fields }]
      : [];
  });
  /** The whole list with one table's fields replaced, minus fields that no longer exist. */
  const phoneFieldsWith = (objectCode: string, fieldKeys: string[]) =>
    phoneObjects
      .map((object) => ({
        objectCode: object.code,
        fieldKeys:
          object.code === objectCode
            ? fieldKeys
            : (saved.get(object.code) ?? []).filter((fieldKey) =>
                object.fields.some((field) => field.fieldKey === fieldKey),
              ),
      }))
      .filter((entry) => entry.fieldKeys.length);
  const bindings = members.data?.members ?? [];

  return (
    <Page width="settings">
      {header}
      {error ? (
        <Alert
          className={styles.alert}
          type="error"
          showIcon
          closable
          title={error}
          onClose={() => setError(undefined)}
        />
      ) : null}
      <div className={styles.grid}>
        <div className={styles.column}>
          <PageSection title="套餐和用量">
            <div className={styles.group}>
              <SettingRow label="套餐">
                <span className={styles.text}>{plan.name}</span>
              </SettingRow>
              <SettingRow label="本月分钟">
                <div className={styles.usage}>
                  <span className={styles.text}>
                    {`${usage.usedMinutes} / ${usage.allowance} 分钟`}
                  </span>
                  <Progress
                    percent={percent}
                    size="small"
                    showInfo={false}
                    status={
                      usage.usedMinutes >= usage.allowance
                        ? "exception"
                        : "normal"
                    }
                  />
                </div>
              </SettingRow>
              <SettingRow label="坐席">
                <span className={styles.text}>
                  {`已开 ${usage.seatsEnabled} / ${plan.seats}`}
                </span>
              </SettingRow>
              {state.lineReady ? null : (
                <SettingRow label="线路">
                  <span className={styles.muted}>
                    员工暂时不能拨号，请联系平台管理员。
                  </span>
                </SettingRow>
              )}
            </div>
          </PageSection>

          <PageSection title="可拨打的号码">
            <div className={styles.group}>
              {objects.isError ? (
                <LoadError
                  error={objects.error}
                  retry={() => void objects.refetch()}
                />
              ) : objects.isPending || schemas.some((q) => q.isPending) ? (
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              ) : phoneObjects.length ? (
                phoneObjects.map((object) => {
                  const keys = saved.get(object.code) ?? [];
                  const current = keys.filter((fieldKey) =>
                    object.fields.some((field) => field.fieldKey === fieldKey),
                  );
                  const stale = keys.length - current.length;
                  return (
                    <SettingRow key={object.code} label={object.name}>
                      <div className={styles.fieldSelect}>
                        <Select
                          mode="multiple"
                          size="small"
                          aria-label={`${object.name}可拨打的字段`}
                          placeholder="不允许拨打"
                          value={current}
                          disabled={save.isPending}
                          onChange={(fieldKeys: string[]) =>
                            save.mutate(phoneFieldsWith(object.code, fieldKeys))
                          }
                          options={object.fields.map((field) => ({
                            value: field.fieldKey,
                            label: field.label,
                          }))}
                        />
                        {stale ? (
                          <Tooltip title="字段已删除或改了类型，下次保存时移除。">
                            <span>
                              <StatusTag tone="warning">
                                {stale} 个失效
                              </StatusTag>
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                    </SettingRow>
                  );
                })
              ) : (
                <p className={styles.empty}>还没有带电话或文本字段的业务表。</p>
              )}
            </div>
          </PageSection>
        </div>

        <PageSection
          title="成员坐席"
          extra={
            <span className={styles.count}>
              {`已开 ${usage.seatsEnabled} / ${plan.seats}`}
            </span>
          }
        >
          <div className={styles.group}>
            {members.isError ? (
              <LoadError
                error={members.error}
                retry={() => void members.refetch()}
              />
            ) : !members.data ? (
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            ) : (
              <ul className={styles.members}>
                {bindings.map((binding) => (
                  <li key={binding.memberId} className={styles.member}>
                    <button
                      type="button"
                      className={styles.memberMain}
                      onClick={() => setEditing(binding)}
                    >
                      <span className={styles.memberName}>
                        {binding.displayName}
                        {binding.status !== "ACTIVE" ? (
                          <StatusTag>已停用</StatusTag>
                        ) : null}
                      </span>
                      <span
                        className={
                          binding.seatStatus === "FAILED"
                            ? styles.failed
                            : styles.muted
                        }
                      >
                        {seatText(binding)}
                      </span>
                    </button>
                    <Switch
                      size="small"
                      aria-label={`${binding.displayName}外呼`}
                      checked={binding.enabled}
                      loading={
                        saveMember.isPending &&
                        saveMember.variables?.memberId === binding.memberId
                      }
                      onChange={(enabled) =>
                        enabled && !dialable(binding.phone)
                          ? setEditing({ ...binding, enabled })
                          : saveMember.mutate({ ...binding, enabled })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </PageSection>
      </div>

      <Modal
        title={editing ? `${editing.displayName}的外呼` : undefined}
        open={Boolean(editing)}
        width={400}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveMember.isPending}
        okButtonProps={{
          disabled: Boolean(editing?.enabled && !dialable(editing.phone.trim())),
        }}
        onOk={() => editing && saveMember.mutate(editing)}
        onCancel={() => setEditing(undefined)}
        destroyOnHidden
      >
        {editing ? (
          <Form layout="vertical" className={styles.modalForm}>
            <Form.Item
              label="接听手机"
              htmlFor="seat-phone"
              help="拨号时线路先回拨这个手机。保存时自动在线路上建坐席。"
            >
              <Input
                id="seat-phone"
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                maxLength={11}
                value={editing.phone}
                onChange={(event) =>
                  setEditing({ ...editing, phone: event.target.value })
                }
              />
            </Form.Item>
            <div className={styles.modalSwitch}>
              <span>允许外呼</span>
              <Switch
                size="small"
                aria-label="允许外呼"
                checked={editing.enabled}
                onChange={(enabled) => setEditing({ ...editing, enabled })}
              />
            </div>
          </Form>
        ) : null}
      </Modal>
    </Page>
  );
}
```

`telephony.module.css`：

- 删掉不再使用的规则：`.switchRow`、`.hint`、`.inlineForm`（连同 `.inlineForm :global(...)` 两段）、`.inlineActions`、`.modalNote`、`.url`、`.copy`。
- 在 `.count` 后面加：

```css
/* This month's minutes: the figure over a thin bar. */
.usage {
  display: grid;
  gap: 2px;
  min-height: 32px;
  align-content: center;
}

/* The supplier refused the seat; its reason in the danger colour. */
.failed {
  color: var(--color-danger);
  font-size: 13px;
}
```

- [ ] **Step 5: 入口只在开通后出现**

`workspace-navigation.ts` 的 `workspaceSettingsNavigation` 改成：

```ts
/**
 * The administration pages, grouped the way the settings sidebar shows them.
 * 电话外呼 appears only once the platform has given the company a plan.
 */
export function workspaceSettingsNavigation(
  tenantCode: string,
  { telephony = false }: { telephony?: boolean } = {},
): WorkspaceNavigationGroup[] {
  const root = `/workspace/${tenantCode}`;
  const groups: WorkspaceNavigationGroup[] = [
    {
      label: "设置",
      items: [{ href: `${root}/settings`, label: "概览", icon: "overview" }],
    },
    {
      label: "成员与权限",
      items: [{ href: `${root}/members`, label: "成员", icon: "members" }],
    },
    {
      label: "数据",
      items: [
        {
          href: `${root}/settings/daily-brief`,
          label: "需要关注",
          icon: "calendar",
        },
        { href: `${root}/settings/ai`, label: "AI", icon: "ai" },
        { href: `${root}/settings/objects`, label: "业务表", icon: "object" },
        {
          href: `${root}/settings/relationships`,
          label: "关系与自动化",
          icon: "relation",
        },
        {
          href: `${root}/settings/dashboards/home`,
          label: "工作台配置",
          icon: "stats",
        },
      ],
    },
    {
      label: "集成",
      items: telephony
        ? [
            {
              href: `${root}/settings/telephony`,
              label: "电话外呼",
              icon: "phone",
            },
          ]
        : [],
    },
    {
      label: "安全",
      items: [{ href: `${root}/audit`, label: "公司审计", icon: "audit" }],
    },
  ];
  return groups.filter((group) => group.items.length);
}
```

`workspace-shell.tsx`：

- `WorkspaceShellProps` 里 `calls?: boolean;` 的注释改为 `/** The company can call, or has past calls to look back on. */`，下面加：

```ts
  /** The platform has given the company a plan, so 电话外呼 shows in settings. */
  telephony?: boolean;
```

- 解构参数加 `telephony = false,`；`...workspaceSettingsNavigation(tenantCode).map(` 改成 `...workspaceSettingsNavigation(tenantCode, { telephony }).map(`。

`app/(workspace)/workspace/[tenantCode]/layout.tsx`：

```ts
      .then((result) => ({
        // The call log stays reachable after calling is turned off.
        calls: Boolean(result.data?.enabled || result.data?.hasHistory),
        telephony: Boolean(result.data?.enabled),
      }))
      .catch(() => ({ calls: false, telephony: false })),
```

注释 `// Calling is optional: a failed read just leaves the call log out of the menu.` 保留；`calls={telephony}` 改为：

```tsx
      calls={telephony.calls}
      telephony={telephony.telephony}
```

`app/(workspace)/workspace/[tenantCode]/settings/page.tsx`：

```ts
  const groups = workspaceSettingsNavigation(tenantCode, {
    telephony: Boolean(telephony.data?.plan),
  }).filter((group) => !group.items.every((item) => item.icon === "overview"));
```

`phone:` 那一项换成：

```ts
            phone: telephony.data?.plan
              ? `${telephony.data.plan.name} · 本月 ${telephony.data.usage.usedMinutes} / ${telephony.data.usage.allowance} 分钟`
              : null,
```

`settings-overview.tsx` 的 `phone.description` 改为 `"查看通话套餐和本月用量，指定可拨打的号码，为成员开外呼。"`。

`record-detail-page.tsx:192`：`enabled: Boolean(telephony?.enabled),` 改为 `enabled: Boolean(telephony?.enabled || telephony?.hasHistory),`。

- [ ] **Step 6: 提醒和审计文案**

`notification-bell.tsx` 的 `groups` 里 `AI_QUOTA_100` 后面加：

```tsx
  TELEPHONY_MINUTES_80: { label: "通话分钟提醒", icon: <PhoneOutlined /> },
  TELEPHONY_MINUTES_100: { label: "通话分钟用尽", icon: <PhoneOutlined /> },
```

同文件第 135 行按钮文字里的

```tsx
{item.kind.startsWith("AI_QUOTA_") ? "查看 AI 用量" : item.kind === "WORK_GOAL_BEHIND" ? "查看目标" : "查看记录"}
```

改成

```tsx
{item.kind.startsWith("AI_QUOTA_") ? "查看 AI 用量" : item.kind.startsWith("TELEPHONY_MINUTES_") ? "查看通话用量" : item.kind === "WORK_GOAL_BEHIND" ? "查看目标" : "查看记录"}
```

`audit-labels.ts`：`actionLabels` 在 `"ai.allocation_changed"` 后面加：

```ts
  "telephony.line_updated": "修改平台电话线路",
  "telephony.callback_token_rotated": "重新生成电话回调地址",
  "telephony.plan_created": "新建通话套餐",
  "telephony.plan_updated": "编辑通话套餐",
  "telephony.plan_deleted": "删除通话套餐",
  "telephony.plan_assigned": "更换公司通话套餐",
  "telephony.minutes_added": "增加本月通话分钟",
  "telephony.settings_updated": "修改可拨打的号码",
  "telephony.member_updated": "调整成员外呼",
  "telephony.call_requested": "发起外呼",
  "telephony.call_closed": "结束通话",
```

`resourceLabels` 在 `tenant_ai_month` 后面加：

```ts
  telephony_platform_settings: "平台电话线路",
  telephony_plan: "通话套餐",
  tenant_telephony_config: "公司通话服务",
  telephony_minute_addition: "通话加量",
  telephony_settings: "公司电话外呼设置",
  telephony_member: "成员外呼",
  telephony_call: "通话",
```

- [ ] **Step 7: 确认测试通过、类型检查通过**

Run: `pnpm --filter @crm/web exec vitest run src/features/telephony src/components/layout src/features/settings src/features/platform/audit-labels.test.ts src/features/notifications && pnpm --filter @crm/web typecheck && pnpm --filter @crm/web exec eslint src/features/telephony src/components src/features/settings src/features/records/record-detail-page.tsx src/features/notifications src/features/platform/audit-labels.ts "src/app/(workspace)"`
Expected: 全部 PASS，类型检查和 lint 无错误。

- [ ] **Step 8: 提交**

```bash
git add apps/web/src/features/telephony apps/web/src/components apps/web/src/features/settings apps/web/src/features/records/record-detail-page.tsx apps/web/src/features/notifications apps/web/src/features/platform/audit-labels.ts apps/web/src/features/platform/audit-labels.test.ts "apps/web/src/app/(workspace)"
git commit -m "$(cat <<'EOF'
电话外呼公司侧网页：套餐和用量、自动建坐席、四种不可用原因，开通后才显示入口

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 平台「电话线路」页

**Files:**
- Create: `apps/web/src/features/platform/telephony/platform-telephony-api.ts`
- Create: `apps/web/src/features/platform/telephony/line-settings.tsx`
- Create: `apps/web/src/features/platform/telephony/platform-telephony.module.css`
- Create: `apps/web/src/features/platform/telephony/platform-telephony.test.tsx`
- Create: `apps/web/src/app/(platform)/platform/settings/telephony/page.tsx`
- Modify: `apps/web/src/app/(platform)/platform/settings/page.tsx`
- Modify: `apps/web/src/components/layout/platform-shell.tsx:102`

**Interfaces:**
- Consumes: Task 5 的平台接口（经 Task 7 生成的类型）；`result()`（`features/platform/ai-governance/common.tsx`）。
- Produces（Task 10、11 用）：
  - `platformTelephonyApi.{ line, updateLine, rotateCallbackToken, plans, createPlan, updatePlan, deletePlan, company, assign, addMinutes, report }`
  - 类型 `PlatformLine`、`PlatformLineInput`、`TelephonyPlan`、`TelephonyPlanInput`、`CompanyTelephonyService`、`TelephonyReport`、`TelephonyReportRow`
  - `MONEY`、`RATE`、`yuan(value, digits = 2)`、`PLATFORM_TELEPHONY_KEY = ["platform-telephony"]`、`LINE_KEY`、`PLANS_KEY`
  - Hooks：`usePlatformLine()`、`useTelephonyPlans()`
  - 组件：`PlatformTelephonyLine`、`PlatformTelephonySummary`；纯函数 `lineState(line)`
  - CSS 类：`page`、`panel`、`form`、`lead`、`ledger`、`meter`、`toolbar`、`pair`、`detail`、`problems`、`additions`、`wide`、`loss`、`url`、`copy`、`table`

- [ ] **Step 1: 写失败的测试**

新建 `apps/web/src/features/platform/telephony/platform-telephony.test.tsx`：

```tsx
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  lineState,
  PlatformTelephonyLine,
  PlatformTelephonySummary,
} from "./line-settings";

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));
vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: api }));

const line = {
  version: 3,
  mode: "KUAIMA" as const,
  companyId: "131",
  hasAppSecret: true,
  hasCallbackToken: false,
  callbackEndpoint: "https://api.example.com/api/v1/telephony/hooks",
  liveEnabled: false,
  mockAllowed: true,
  costPerMinute: "0.1500",
  seatMonthlyCost: "10.00",
  ready: false,
  problems: [
    "回调地址未生成",
    "服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）",
  ],
  seats: 4,
};
const plan = {
  id: "p1",
  name: "标准版",
  seats: 3,
  monthlyMinutes: 1000,
  monthlyPrice: "120.00",
  assignable: true,
  version: 2,
  companies: 1,
};
const company = {
  tenantId: "t",
  version: 1,
  planId: "p1",
  planName: "标准版",
  seats: 3,
  monthlyMinutes: 100,
  month: "2026-11-01",
  usedMinutes: 2,
  extraMinutes: 30,
  allowance: 130,
  seatsEnabled: 2,
  additions: [
    {
      month: "2026-11-01",
      minutes: 30,
      price: "30.00",
      note: "月中加量",
      createdAt: "2026-11-20T08:00:00.000Z",
    },
  ],
};
const report = {
  month: "2026-11",
  seatMonthlyCost: "10.00",
  rows: [
    {
      tenantId: "t",
      tenantName: "星云科技",
      planName: "标准版",
      monthlyMinutes: 100,
      usedMinutes: 2,
      extraMinutes: 30,
      allowance: 130,
      planPrice: "120.00",
      extraPrice: "30.00",
      revenue: "150.00",
      minuteCost: "0.30",
      seatCost: "20.00",
      cost: "20.30",
      margin: "129.70",
      seatsProvisioned: 2,
    },
  ],
  total: { usedMinutes: 2, revenue: "150.00", cost: "20.30", margin: "129.70" },
};
function show(ui: React.ReactNode) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith("telephony-settings")
      ? line
      : path.endsWith("telephony-plans")
        ? [plan]
        : path.endsWith("telephony-report")
          ? report
          : company,
  }));
});

describe("平台电话线路", () => {
  it("写明线路缺什么，密钥留空就不修改", async () => {
    api.PATCH.mockResolvedValue({ data: { ...line, version: 4, companyId: "132" } });
    show(<PlatformTelephonyLine />);
    expect(await screen.findByText("回调地址未生成")).toBeInTheDocument();
    expect(
      screen.getByText("服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("快马企业 ID"), {
      target: { value: "132" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/platform/telephony-settings",
        {
          body: {
            version: 3,
            mode: "KUAIMA",
            companyId: "132",
            costPerMinute: "0.1500",
            seatMonthlyCost: "10.00",
          },
        },
      ),
    );
  });

  it("新的回调地址只显示这一次", async () => {
    const url = "https://api.example.com/api/v1/telephony/hooks?token=abc";
    api.POST.mockResolvedValue({
      data: { settings: { ...line, hasCallbackToken: true }, callbackUrl: url },
    });
    show(<PlatformTelephonyLine />);
    fireEvent.click(await screen.findByRole("button", { name: /生\s*成/ }));
    expect(await screen.findByDisplayValue(url)).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByText(/只显示这一次/),
    ).toBeInTheDocument();
  });

  it("系统设置页显示线路状态和入口", async () => {
    show(<PlatformTelephonySummary />);
    expect(await screen.findByText("未就绪")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /管理电话线路/ }),
    ).toHaveAttribute("href", "/platform/settings/telephony");
  });

  it("就绪的线路按类型称呼", () => {
    expect(lineState({ mode: "KUAIMA", ready: true })).toEqual({
      label: "快马回拨",
      tone: "success",
    });
    expect(lineState({ mode: "MOCK", ready: true }).label).toBe("模拟线路");
    expect(lineState({ mode: "KUAIMA", ready: false }).label).toBe("未就绪");
  });
});
```

（`plan`、`company`、`report` 这三个样例数据给 Task 10、11 的测试用，这一步先放着。）

- [ ] **Step 2: 确认测试失败**

Run: `pnpm --filter @crm/web exec vitest run src/features/platform/telephony`
Expected: FAIL，`Failed to resolve import "./line-settings"`。

- [ ] **Step 3: 写接口和共用工具**

`platform-telephony-api.ts`：

```ts
"use client";
import type { components } from "@crm/contracts";
import { useQuery } from "@tanstack/react-query";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient as api } from "@/lib/api/browser-client";

import { result } from "../ai-governance/common";

type Schemas = components["schemas"];
export type PlatformLine = Schemas["PlatformTelephonyResponseDto"];
export type PlatformLineInput = Schemas["UpdatePlatformTelephonyDto"];
export type TelephonyPlan = Schemas["TelephonyPlanResponseDto"];
export type TelephonyPlanInput = Schemas["TelephonyPlanInputDto"];
export type CompanyTelephonyService =
  Schemas["PlatformTenantTelephonyResponseDto"];
export type TelephonyReport = Schemas["TelephonyReportResponseDto"];
export type TelephonyReportRow = Schemas["TelephonyReportRowDto"];

/** Money in yuan, up to two decimals; the API checks the same. */
export const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** A per-minute price in yuan, up to four decimals; the API checks the same. */
export const RATE = /^\d{1,6}(\.\d{1,4})?$/;

/** Every platform telephony query starts with this, so one invalidation refreshes them all. */
export const PLATFORM_TELEPHONY_KEY = ["platform-telephony"] as const;
export const LINE_KEY = [...PLATFORM_TELEPHONY_KEY, "line"] as const;
export const PLANS_KEY = [...PLATFORM_TELEPHONY_KEY, "plans"] as const;

/** "1234.5" → "¥1,234.50"; a loss reads "-¥5.00". */
export function yuan(value: string | number, digits = 2) {
  const amount = Number(value);
  const text = Math.abs(amount).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (amount < 0 ? "-¥" : "¥") + text;
}

export const platformTelephonyApi = {
  line: () => result(api.GET("/api/v1/platform/telephony-settings")),
  updateLine: (body: PlatformLineInput) =>
    result(api.PATCH("/api/v1/platform/telephony-settings", { body })),
  rotateCallbackToken: () =>
    result(api.POST("/api/v1/platform/telephony-settings/callback-token")),
  plans: () => result(api.GET("/api/v1/platform/telephony-plans")),
  createPlan: (body: TelephonyPlanInput) =>
    result(api.POST("/api/v1/platform/telephony-plans", { body })),
  updatePlan: (id: string, body: TelephonyPlanInput & { version: number }) =>
    result(
      api.PATCH("/api/v1/platform/telephony-plans/{id}", {
        params: { path: { id } },
        body,
      }),
    ),
  /** 204 has no body, so success is the status alone. */
  deletePlan: async (id: string, version: number) => {
    const { error, response } = await api.DELETE(
      "/api/v1/platform/telephony-plans/{id}",
      { params: { path: { id }, query: { version } } },
    );
    if (!response.ok) throw toApiError(error, response.status);
  },
  company: (tenantId: string) =>
    result(
      api.GET("/api/v1/platform/tenants/{tenantId}/telephony", {
        params: { path: { tenantId } },
      }),
    ),
  assign: (tenantId: string, body: { version: number; planId: string | null }) =>
    result(
      api.PATCH("/api/v1/platform/tenants/{tenantId}/telephony", {
        params: { path: { tenantId } },
        body,
      }),
    ),
  addMinutes: (tenantId: string, body: Schemas["AddTelephonyMinutesDto"]) =>
    result(
      api.POST("/api/v1/platform/tenants/{tenantId}/telephony/minutes", {
        params: { path: { tenantId } },
        body,
      }),
    ),
  report: (month: string) =>
    result(
      api.GET("/api/v1/platform/telephony-report", {
        params: { query: { month } },
      }),
    ),
};

export function usePlatformLine() {
  return useQuery({ queryKey: LINE_KEY, queryFn: platformTelephonyApi.line });
}
export function useTelephonyPlans() {
  return useQuery({ queryKey: PLANS_KEY, queryFn: platformTelephonyApi.plans });
}
```

`platform-telephony.module.css`：

```css
/* Platform telephony: the line, the plans, the books and a company's card,
   in the same rhythm as the AI plan pages. */
.page,
.panel,
.form {
  display: grid;
  gap: var(--space-4, 16px);
  min-width: 0;
}
.panel {
  padding: clamp(14px, 2vw, 24px);
}
.form {
  gap: 8px;
}
.lead,
.ledger,
.meter,
.toolbar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar {
  align-items: center;
}
.lead h3 {
  margin: 0;
  font-size: 1.4rem;
}
.meter strong {
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
}
.ledger {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
/* Two short money fields side by side, stacked on a phone. */
.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  gap: 0 16px;
}
.detail {
  color: var(--text-secondary);
  font-size: 0.82rem;
}
.problems {
  margin: 0;
  padding-left: 18px;
}
.additions {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.additions li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-variant-numeric: tabular-nums;
}
.wide {
  width: 100%;
}
.loss {
  color: var(--color-danger);
}
.url {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  word-break: break-all;
}
.copy {
  margin-top: 8px;
}
.table :global(.ant-table-thead > tr > th),
.table :global(.ant-table-tbody > tr > td) {
  white-space: nowrap;
}
```

- [ ] **Step 4: 写线路页和系统设置里的摘要**

`line-settings.tsx`：

```tsx
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Space,
} from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { PageSection, SettingRow } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";
import { ReadingPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { toApiError } from "@/lib/api/api-error";

import {
  LINE_KEY,
  MONEY,
  platformTelephonyApi,
  RATE,
  usePlatformLine,
  type PlatformLine,
} from "./platform-telephony-api";
import styles from "./platform-telephony.module.css";

/** Where the platform line stands, in two or three words. */
export function lineState(line: Pick<PlatformLine, "mode" | "ready">): {
  label: string;
  tone: StatusTone;
} {
  if (!line.ready) return { label: "未就绪", tone: "warning" };
  return line.mode === "MOCK"
    ? { label: "模拟线路", tone: "info" }
    : { label: "快马回拨", tone: "success" };
}

/** The line's row on 系统设置, linking to its own page. */
export function PlatformTelephonySummary() {
  const line = usePlatformLine();
  const data = line.data;
  return (
    <PageSection title="电话线路">
      <ReadingPanel className={styles.panel}>
        {data ? (
          <SettingRow
            label="线路状态"
            help={data.problems[0] ?? `已建坐席 ${data.seats} 个`}
          >
            <Space wrap>
              <StatusTag tone={lineState(data).tone}>
                {lineState(data).label}
              </StatusTag>
              <Button href="/platform/settings/telephony">管理电话线路</Button>
            </Space>
          </SettingRow>
        ) : line.isError ? (
          <LoadError error={line.error} retry={() => void line.refetch()} />
        ) : (
          <Skeleton active paragraph={{ rows: 1 }} title={false} />
        )}
      </ReadingPanel>
    </PageSection>
  );
}

type LineForm = {
  mode: "MOCK" | "KUAIMA";
  companyId: string;
  appSecret: string;
  costPerMinute: string;
  seatMonthlyCost: string;
};

/**
 * The platform's one supplier line: account, buying prices and the callback
 * address every company's calls report back to.
 */
export function PlatformTelephonyLine() {
  const line = usePlatformLine();
  const client = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string>();
  const fail = (cause: unknown) => {
    const apiError = toApiError(cause);
    setError(
      apiError.status === 409
        ? "线路设置刚被修改，已刷新为最新内容，请再试一次。"
        : apiError.message,
    );
    if (apiError.status === 409) void line.refetch();
  };
  const save = useMutation({
    mutationFn: (values: LineForm) =>
      platformTelephonyApi.updateLine({
        version: line.data?.version ?? 0,
        mode: values.mode,
        companyId: values.companyId.trim(),
        // A blank secret keeps the saved one.
        ...(values.appSecret.trim()
          ? { appSecret: values.appSecret.trim() }
          : {}),
        costPerMinute: values.costPerMinute,
        seatMonthlyCost: values.seatMonthlyCost,
      }),
    onMutate: () => setError(undefined),
    onSuccess: (saved) => {
      client.setQueryData(LINE_KEY, saved);
      toast.success("线路已保存");
    },
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: () => platformTelephonyApi.rotateCallbackToken(),
    onMutate: () => setError(undefined),
    onSuccess: (issued) => {
      client.setQueryData(LINE_KEY, issued.settings);
      setConfirming(false);
      setCallbackUrl(issued.callbackUrl);
    },
    onError: (cause) => {
      setConfirming(false);
      fail(cause);
    },
  });

  const data = line.data;
  if (!data)
    return (
      <div className={styles.page}>
        <PageHeader title="电话线路" />
        {line.isError ? (
          <LoadError error={line.error} retry={() => void line.refetch()} />
        ) : (
          <Skeleton active />
        )}
      </div>
    );
  const state = lineState(data);
  return (
    <div className={styles.page}>
      <PageHeader
        title="电话线路"
        description="所有公司共用这一条线路拨号。"
        status={<StatusTag tone={state.tone}>{state.label}</StatusTag>}
      />
      {data.problems.length ? (
        <Alert
          type="warning"
          showIcon
          title="线路暂不可用，各公司员工都不能拨号"
          description={
            <ul className={styles.problems}>
              {data.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {error ? (
        <Alert
          type="error"
          showIcon
          closable
          title={error}
          onClose={() => setError(undefined)}
        />
      ) : null}
      <PageSection title="账号和进价">
        <ReadingPanel className={styles.panel}>
          <Form<LineForm>
            key={data.version}
            layout="vertical"
            requiredMark={false}
            initialValues={{
              mode: data.mode,
              companyId: data.companyId,
              appSecret: "",
              costPerMinute: data.costPerMinute,
              seatMonthlyCost: data.seatMonthlyCost,
            }}
            onFinish={(values) => save.mutate(values)}
          >
            <Form.Item label="线路" name="mode">
              <Segmented
                options={[
                  { value: "MOCK", label: "模拟", disabled: !data.mockAllowed },
                  { value: "KUAIMA", label: "快马回拨" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="快马企业 ID"
              name="companyId"
              rules={[{ max: 100, message: "最多 100 个字符" }]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="快马企业密钥"
              name="appSecret"
              extra={
                data.hasAppSecret
                  ? "已保存。不修改请留空。"
                  : "加密保存，保存后谁都看不到原文。"
              }
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <div className={styles.pair}>
              <Form.Item
                label="每分钟进价（元）"
                name="costPerMinute"
                rules={[{ pattern: RATE, message: "请输入金额，最多四位小数" }]}
              >
                <Input inputMode="decimal" />
              </Form.Item>
              <Form.Item
                label="每坐席每月进价（元）"
                name="seatMonthlyCost"
                rules={[{ pattern: MONEY, message: "请输入金额，最多两位小数" }]}
              >
                <Input inputMode="decimal" />
              </Form.Item>
            </div>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存
            </Button>
          </Form>
        </ReadingPanel>
      </PageSection>
      <PageSection title="回调和状态">
        <ReadingPanel className={styles.panel}>
          <SettingRow label="回调地址" help={data.callbackEndpoint}>
            <Space wrap>
              <StatusTag tone={data.hasCallbackToken ? "success" : "neutral"}>
                {data.hasCallbackToken ? "已生成" : "未生成"}
              </StatusTag>
              <Button
                loading={rotate.isPending && !confirming}
                onClick={() =>
                  data.hasCallbackToken ? setConfirming(true) : rotate.mutate()
                }
              >
                {data.hasCallbackToken ? "重新生成" : "生成"}
              </Button>
            </Space>
          </SettingRow>
          <SettingRow
            label="真实外呼"
            help="由部署配置 TELEPHONY_LIVE_ENABLED 控制。关闭时不拨真实电话，也不建真实坐席。"
          >
            <StatusTag tone={data.liveEnabled ? "success" : "warning"}>
              {data.liveEnabled ? "服务器已开启" : "服务器未开启"}
            </StatusTag>
          </SettingRow>
          <SettingRow label="已建坐席">{`${data.seats} 个`}</SettingRow>
        </ReadingPanel>
      </PageSection>
      <Modal
        open={confirming}
        title="重新生成回调地址？"
        okText="重新生成"
        cancelText="取消"
        confirmLoading={rotate.isPending}
        onOk={() => rotate.mutate()}
        onCancel={() => setConfirming(false)}
      >
        旧地址立即失效，需要把新地址发给快马客服重新配置。
      </Modal>
      <Modal
        open={Boolean(callbackUrl)}
        title="回调地址"
        maskClosable={false}
        onCancel={() => setCallbackUrl(undefined)}
        footer={
          <Button type="primary" onClick={() => setCallbackUrl(undefined)}>
            我已复制
          </Button>
        }
      >
        <p className={styles.detail}>
          只显示这一次。复制后发给快马客服，配置为话单推送地址。
        </p>
        <Input.TextArea
          aria-label="回调地址"
          readOnly
          autoSize
          value={callbackUrl}
          className={styles.url}
          onFocus={(event) => event.target.select()}
        />
        <Button
          className={styles.copy}
          size="small"
          onClick={() =>
            callbackUrl &&
            void navigator.clipboard
              .writeText(callbackUrl)
              .then(() => toast.success("已复制"))
          }
        >
          复制
        </Button>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 5: 接进路由、系统设置和面包屑**

新建 `apps/web/src/app/(platform)/platform/settings/telephony/page.tsx`：

```tsx
import { PlatformTelephonyLine } from "@/features/platform/telephony/line-settings";

export default function Page() {
  return <PlatformTelephonyLine />;
}
```

`apps/web/src/app/(platform)/platform/settings/page.tsx`：import `PlatformTelephonySummary`（`@/features/platform/telephony/line-settings`），在 `<PlatformAiSettings />` 后面加 `<PlatformTelephonySummary />`。

`platform-shell.tsx` 第 102 行改为：

```tsx
          {NESTED_LABELS[pathname] ?? "详情"}
```

并在文件顶部常量区加：

```ts
/** Nested pages that have a name of their own in the breadcrumb. */
const NESTED_LABELS: Record<string, string> = {
  "/platform/settings/ai-models": "AI 模型",
  "/platform/settings/telephony": "电话线路",
};
```

- [ ] **Step 6: 确认测试通过**

Run: `pnpm --filter @crm/web exec vitest run src/features/platform/telephony src/components/layout && pnpm --filter @crm/web typecheck && pnpm --filter @crm/web exec eslint src/features/platform/telephony src/components/layout "src/app/(platform)"`
Expected: 全部 PASS，无类型和 lint 错误。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/platform/telephony "apps/web/src/app/(platform)/platform/settings" apps/web/src/components/layout/platform-shell.tsx
git commit -m "$(cat <<'EOF'
平台电话线路页：企业账号、进价、回调地址和线路状态

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 平台「通话套餐」页和「收支」标签

**Files:**
- Create: `apps/web/src/features/platform/telephony/plans-page.tsx`
- Create: `apps/web/src/features/platform/telephony/report.tsx`
- Create: `apps/web/src/app/(platform)/platform/telephony-plans/page.tsx`
- Modify: `apps/web/src/components/navigation/platform-navigation.ts`
- Test: `apps/web/src/features/platform/telephony/platform-telephony.test.tsx`

**Interfaces:**
- Consumes: Task 9 的 `platformTelephonyApi`、`useTelephonyPlans`、`MONEY`、`yuan`、`PLATFORM_TELEPHONY_KEY`、CSS 类。
- Produces: `PlatformTelephonyPlans`（页面）、`TelephonyReportPanel({ initialMonth? })`。

- [ ] **Step 1: 写失败的测试**

`platform-telephony.test.tsx` 顶部 import 加 `import { PlatformTelephonyPlans } from "./plans-page";`，文件末尾加：

```tsx
describe("通话套餐", () => {
  it("列出套餐，保存前校验月售价", async () => {
    api.POST.mockResolvedValue({ data: { ...plan, id: "p2" } });
    show(<PlatformTelephonyPlans />);
    expect(await screen.findByText("标准版")).toBeInTheDocument();
    expect(screen.getByText("¥120.00")).toBeInTheDocument();
    // In use by a company: no delete.
    expect(screen.queryByRole("button", { name: /删\s*除/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建套餐" }));
    fireEvent.change(await screen.findByLabelText("套餐名称"), {
      target: { value: "旗舰版" },
    });
    fireEvent.change(screen.getByLabelText("月售价（元）"), {
      target: { value: "1.234" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(
      await screen.findByText("请输入金额，最多两位小数"),
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("月售价（元）"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith("/api/v1/platform/telephony-plans", {
        body: {
          name: "旗舰版",
          seats: 5,
          monthlyMinutes: 1000,
          monthlyPrice: "300",
          assignable: true,
        },
      }),
    );
  });

  it("只有没公司在用的套餐能删，删除时带版本号", async () => {
    api.GET.mockImplementation(async () => ({ data: [{ ...plan, companies: 0 }] }));
    api.DELETE.mockResolvedValue({ response: new Response(null, { status: 204 }) });
    show(<PlatformTelephonyPlans />);
    fireEvent.click(await screen.findByRole("button", { name: /删\s*除/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /删\s*除/,
      }),
    );
    await waitFor(() =>
      expect(api.DELETE).toHaveBeenCalledWith(
        "/api/v1/platform/telephony-plans/{id}",
        { params: { path: { id: "p1" }, query: { version: 2 } } },
      ),
    );
  });

  it("收支标签按公司列出收入、成本、毛利和合计", async () => {
    show(<PlatformTelephonyPlans />);
    fireEvent.click(await screen.findByRole("tab", { name: "收支" }));
    expect(await screen.findByText("星云科技")).toBeInTheDocument();
    expect(screen.getAllByText("¥129.70")).toHaveLength(2);
    expect(screen.getByText("合计")).toBeInTheDocument();
    expect(
      screen.getByText(/坐席成本按当前坐席月进价 ¥10.00 计算/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 确认测试失败**

Run: `pnpm --filter @crm/web exec vitest run src/features/platform/telephony`
Expected: FAIL，`Failed to resolve import "./plans-page"`。

- [ ] **Step 3: 写收支标签**

`report.tsx`：

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Skeleton, Table, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";

import { DataPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";

import {
  PLATFORM_TELEPHONY_KEY,
  platformTelephonyApi,
  yuan,
  type TelephonyReportRow,
} from "./platform-telephony-api";
import styles from "./platform-telephony.module.css";

const money = (value: string) => (
  <span className={Number(value) < 0 ? styles.loss : undefined}>
    {yuan(value)}
  </span>
);

/** One month's revenue, cost and margin, a row per company and a total. */
export function TelephonyReportPanel({
  initialMonth = dayjs().format("YYYY-MM"),
}: {
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const report = useQuery({
    queryKey: [...PLATFORM_TELEPHONY_KEY, "report", month],
    queryFn: () => platformTelephonyApi.report(month),
  });
  const data = report.data;
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <DatePicker
          picker="month"
          aria-label="月份"
          allowClear={false}
          value={dayjs(`${month}-01`)}
          disabledDate={(day) => day.isAfter(dayjs(), "month")}
          onChange={(day: Dayjs | null) => day && setMonth(day.format("YYYY-MM"))}
        />
        {data ? (
          <span className={styles.detail}>
            {`坐席成本按当前坐席月进价 ${yuan(data.seatMonthlyCost)} 计算，没有按月保存。`}
          </span>
        ) : null}
      </div>
      {data ? (
        <DataPanel ariaLabel="通话收支">
          <Table<TelephonyReportRow>
            rowKey="tenantId"
            className={styles.table}
            dataSource={data.rows}
            pagination={false}
            locale={{ emptyText: "这个月没有开通通话的公司" }}
            columns={[
              { title: "公司", dataIndex: "tenantName" },
              { title: "套餐", render: (_, row) => row.planName ?? "—" },
              {
                title: "分钟",
                render: (_, row) => `${row.usedMinutes} / ${row.allowance}`,
              },
              {
                title: "收入",
                align: "right",
                render: (_, row) => (
                  <Tooltip
                    title={`套餐 ${yuan(row.planPrice)} + 加量 ${yuan(row.extraPrice)}`}
                  >
                    {yuan(row.revenue)}
                  </Tooltip>
                ),
              },
              {
                title: "成本",
                align: "right",
                render: (_, row) => (
                  <Tooltip
                    title={`通话 ${yuan(row.minuteCost)} + 坐席 ${yuan(row.seatCost)}（${row.seatsProvisioned} 个）`}
                  >
                    {yuan(row.cost)}
                  </Tooltip>
                ),
              },
              {
                title: "毛利",
                align: "right",
                render: (_, row) => money(row.margin),
              },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <strong>合计</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>
                  {data.total.usedMinutes}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  {yuan(data.total.revenue)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  {yuan(data.total.cost)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  {money(data.total.margin)}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
        </DataPanel>
      ) : report.isError ? (
        <LoadError error={report.error} retry={() => void report.refetch()} />
      ) : (
        <Skeleton active />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 写套餐页**

`plans-page.tsx`：

```tsx
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Space,
  Switch,
  Table,
  Tabs,
} from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { DataPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { toApiError } from "@/lib/api/api-error";

import {
  MONEY,
  PLATFORM_TELEPHONY_KEY,
  platformTelephonyApi,
  useTelephonyPlans,
  yuan,
  type TelephonyPlan,
  type TelephonyPlanInput,
} from "./platform-telephony-api";
import { TelephonyReportPanel } from "./report";
import styles from "./platform-telephony.module.css";

const NEW_PLAN: TelephonyPlanInput = {
  name: "",
  seats: 5,
  monthlyMinutes: 1000,
  monthlyPrice: "",
  assignable: true,
};
const editable = (plan: TelephonyPlan): TelephonyPlanInput => ({
  name: plan.name,
  seats: plan.seats,
  monthlyMinutes: plan.monthlyMinutes,
  monthlyPrice: plan.monthlyPrice,
  assignable: plan.assignable,
});

/** 通话套餐: the plans the platform sells, and the books on a second tab. */
export function PlatformTelephonyPlans() {
  const plans = useTelephonyPlans();
  const client = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("plans");
  const [editor, setEditor] = useState<TelephonyPlan | "new" | null>(null);
  const [target, setTarget] = useState<TelephonyPlan | null>(null);
  const [error, setError] = useState<string>();
  const [form] = Form.useForm<TelephonyPlanInput>();
  const current = editor && editor !== "new" ? editor : null;
  const done = async (text: string) => {
    toast.success(text);
    await client.invalidateQueries({ queryKey: PLATFORM_TELEPHONY_KEY });
  };
  const fail = (cause: unknown) => setError(toApiError(cause).message);
  const save = useMutation({
    mutationFn: (values: TelephonyPlanInput) => {
      const body = { ...values, name: values.name.trim() };
      return current
        ? platformTelephonyApi.updatePlan(current.id, {
            ...body,
            version: current.version,
          })
        : platformTelephonyApi.createPlan(body);
    },
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      const text = current ? "套餐已更新" : "已新建套餐";
      setEditor(null);
      await done(text);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (plan: TelephonyPlan) =>
      platformTelephonyApi.deletePlan(plan.id, plan.version),
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      setTarget(null);
      await done("套餐已删除");
    },
    onError: fail,
  });
  function open(plan: TelephonyPlan | "new") {
    setError(undefined);
    setEditor(plan);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="通话套餐"
        count={tab === "plans" ? plans.data?.length : undefined}
        extra={
          tab === "plans" ? (
            <Button
              type="primary"
              disabled={!plans.data}
              onClick={() => open("new")}
            >
              新建套餐
            </Button>
          ) : null
        }
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "plans",
            label: "套餐",
            children: plans.data ? (
              <DataPanel ariaLabel="通话套餐列表">
                <Table<TelephonyPlan>
                  rowKey="id"
                  className={styles.table}
                  dataSource={plans.data}
                  pagination={false}
                  locale={{
                    emptyText: <Empty description="还没有通话套餐" />,
                  }}
                  columns={[
                    {
                      title: "套餐名称",
                      dataIndex: "name",
                      render: (_, plan) => <strong>{plan.name}</strong>,
                    },
                    { title: "坐席", render: (_, plan) => `${plan.seats} 个` },
                    {
                      title: "每月分钟",
                      render: (_, plan) =>
                        plan.monthlyMinutes.toLocaleString("zh-CN"),
                    },
                    {
                      title: "月售价",
                      align: "right",
                      render: (_, plan) => yuan(plan.monthlyPrice),
                    },
                    {
                      title: "使用公司",
                      render: (_, plan) => `${plan.companies} 家`,
                    },
                    {
                      title: "分配状态",
                      render: (_, plan) => (
                        <StatusTag tone={plan.assignable ? "success" : "neutral"}>
                          {plan.assignable ? "可分配" : "已停止分配"}
                        </StatusTag>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_, plan) => (
                        <Space size="small">
                          <Button
                            size="small"
                            type="link"
                            onClick={() => open(plan)}
                          >
                            编辑
                          </Button>
                          {plan.companies === 0 ? (
                            <Button
                              size="small"
                              type="link"
                              danger
                              onClick={() => {
                                setError(undefined);
                                setTarget(plan);
                              }}
                            >
                              删除
                            </Button>
                          ) : null}
                        </Space>
                      ),
                    },
                  ]}
                />
              </DataPanel>
            ) : plans.isError ? (
              <LoadError
                error={plans.error}
                retry={() => void plans.refetch()}
              />
            ) : (
              <Skeleton active />
            ),
          },
          { key: "report", label: "收支", children: <TelephonyReportPanel /> },
        ]}
      />
      <Drawer
        open={Boolean(editor)}
        title={current ? "编辑套餐" : "新建套餐"}
        destroyOnHidden
        onClose={() => {
          if (!save.isPending) setEditor(null);
        }}
        footer={
          <Space>
            <Button disabled={save.isPending} onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button
              type="primary"
              loading={save.isPending}
              onClick={() => form.submit()}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Form<TelephonyPlanInput>
          key={current?.id ?? "new"}
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={current ? editable(current) : NEW_PLAN}
          onFinish={(values) => save.mutate(values)}
        >
          <Form.Item
            label="套餐名称"
            name="name"
            rules={[
              { required: true, whitespace: true, message: "请填写套餐名称" },
            ]}
          >
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item
            label="坐席数"
            name="seats"
            extra={
              current?.companies
                ? "不能少于使用这个套餐的公司已开的坐席。"
                : undefined
            }
            rules={[{ required: true, message: "请填写坐席数" }]}
          >
            <InputNumber
              min={1}
              max={10000}
              precision={0}
              className={styles.wide}
            />
          </Form.Item>
          <Form.Item
            label="每月分钟"
            name="monthlyMinutes"
            rules={[{ required: true, message: "请填写每月分钟" }]}
          >
            <InputNumber
              min={0}
              max={10_000_000}
              precision={0}
              className={styles.wide}
            />
          </Form.Item>
          <Form.Item
            label="月售价（元）"
            name="monthlyPrice"
            rules={[
              { required: true, message: "请填写月售价" },
              { pattern: MONEY, message: "请输入金额，最多两位小数" },
            ]}
          >
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item
            label="允许分配给公司"
            name="assignable"
            valuePropName="checked"
          >
            <Switch checkedChildren="可分配" unCheckedChildren="停止分配" />
          </Form.Item>
        </Form>
        {current?.companies ? (
          <p className={styles.detail}>
            {current.companies} 家公司正在用这个套餐，保存后立即生效。
          </p>
        ) : null}
        {editor && error ? <Alert type="error" showIcon title={error} /> : null}
      </Drawer>
      <Modal
        open={Boolean(target)}
        title="删除套餐"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={remove.isPending}
        onOk={() => target && remove.mutate(target)}
        onCancel={() => setTarget(null)}
      >
        <p>删除「{target?.name}」？没有公司在用这个套餐。</p>
        {target && error ? <Alert type="error" showIcon title={error} /> : null}
      </Modal>
    </div>
  );
}
```

- [ ] **Step 5: 加路由和导航**

新建 `apps/web/src/app/(platform)/platform/telephony-plans/page.tsx`：

```tsx
import { PlatformTelephonyPlans } from "@/features/platform/telephony/plans-page";

export default function Page() {
  return <PlatformTelephonyPlans />;
}
```

`platform-navigation.ts` 在 `AI 套餐` 后面加一行：

```ts
  { href: "/platform/telephony-plans", label: "通话套餐", icon: "phone" },
```

- [ ] **Step 6: 确认测试通过**

Run: `pnpm --filter @crm/web exec vitest run src/features/platform src/components && pnpm --filter @crm/web typecheck && pnpm --filter @crm/web exec eslint src/features/platform/telephony src/components/navigation "src/app/(platform)"`
Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/platform/telephony "apps/web/src/app/(platform)/platform/telephony-plans" apps/web/src/components/navigation/platform-navigation.ts
git commit -m "$(cat <<'EOF'
平台通话套餐页：套餐增改删，收支标签按月看收入、成本和毛利

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 公司详情页的「通话服务」卡片

**Files:**
- Create: `apps/web/src/features/platform/telephony/company-telephony.tsx`
- Modify: `apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx:150`
- Test: `apps/web/src/features/platform/telephony/platform-telephony.test.tsx`

**Interfaces:**
- Consumes: Task 9 的 `platformTelephonyApi.company / assign / addMinutes`、`useTelephonyPlans`、`MONEY`、`yuan`、`PLATFORM_TELEPHONY_KEY`、CSS 类。
- Produces: `CompanyTelephony({ tenantId })`。

- [ ] **Step 1: 写失败的测试**

`platform-telephony.test.tsx` 顶部 import 加 `import { CompanyTelephony } from "./company-telephony";`，文件末尾加：

```tsx
describe("公司通话服务", () => {
  it("显示本月分钟和坐席，加分钟带本月和幂等键", async () => {
    api.POST.mockResolvedValue({ data: { applied: true, month: "2026-11-01" } });
    show(<CompanyTelephony tenantId="t" />);
    expect(await screen.findByText("标准版")).toBeInTheDocument();
    expect(screen.getByText("坐席 2 / 3")).toBeInTheDocument();
    expect(screen.getByText(/月中加量/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加分钟" }));
    fireEvent.change(await screen.findByLabelText("增加分钟"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("收费（元）"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认加量" }));
    await waitFor(() =>
      expect(api.POST).toHaveBeenCalledWith(
        "/api/v1/platform/tenants/{tenantId}/telephony/minutes",
        {
          params: { path: { tenantId: "t" } },
          body: {
            month: "2026-11-01",
            minutes: 50,
            price: "30",
            note: "",
            idempotencyKey: expect.any(String),
          },
        },
      ),
    );
  });

  it("可以换套餐，也可以改回未开通", async () => {
    api.PATCH.mockResolvedValue({
      data: { ...company, planId: null, planName: null },
    });
    show(<CompanyTelephony tenantId="t" />);
    fireEvent.click(await screen.findByRole("button", { name: "更换套餐" }));
    fireEvent.mouseDown(await screen.findByLabelText("通话套餐"));
    fireEvent.click(await screen.findByTitle("未开通"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /保\s*存/ }),
    );
    await waitFor(() =>
      expect(api.PATCH).toHaveBeenCalledWith(
        "/api/v1/platform/tenants/{tenantId}/telephony",
        { params: { path: { tenantId: "t" } }, body: { version: 1, planId: null } },
      ),
    );
  });
});
```

- [ ] **Step 2: 确认测试失败**

Run: `pnpm --filter @crm/web exec vitest run src/features/platform/telephony`
Expected: FAIL，`Failed to resolve import "./company-telephony"`。

- [ ] **Step 3: 写卡片**

`company-telephony.tsx`：

```tsx
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Skeleton,
  Space,
  Tag,
} from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { PageSection } from "@/components/layout/page";
import { ReadingPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { toApiError } from "@/lib/api/api-error";

import {
  MONEY,
  PLATFORM_TELEPHONY_KEY,
  platformTelephonyApi,
  useTelephonyPlans,
  yuan,
} from "./platform-telephony-api";
import styles from "./platform-telephony.module.css";

/** 通话服务 on the platform's company page: plan, this month's use and added minutes. */
export function CompanyTelephony({ tenantId }: { tenantId: string }) {
  const company = useQuery({
    queryKey: [...PLATFORM_TELEPHONY_KEY, "company", tenantId],
    queryFn: () => platformTelephonyApi.company(tenantId),
  });
  const plans = useTelephonyPlans();
  const client = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"assign" | "minutes" | null>(null);
  const [planId, setPlanId] = useState("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  // One key per entered addition: a resent request adds once, an edit is new.
  const [requestKey, setRequestKey] = useState("");
  const [error, setError] = useState<string>();
  const c = company.data;
  const submit = useMutation({
    mutationFn: async () => {
      if (!c) return;
      if (mode === "assign")
        await platformTelephonyApi.assign(tenantId, {
          version: c.version,
          planId: planId || null,
        });
      else
        await platformTelephonyApi.addMinutes(tenantId, {
          month: c.month,
          minutes: minutes ?? 0,
          price,
          note: note.trim(),
          idempotencyKey: requestKey,
        });
    },
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      toast.success(mode === "assign" ? "通话套餐已保存" : "本月分钟已增加");
      setMode(null);
      await client.invalidateQueries({ queryKey: PLATFORM_TELEPHONY_KEY });
    },
    onError: (cause) => {
      const apiError = toApiError(cause);
      setError(apiError.message);
      if (apiError.status === 409) void company.refetch();
    },
  });

  if (!c || !plans.data)
    return (
      <PageSection title="通话服务">
        {company.isError || plans.isError ? (
          <LoadError
            error={company.error ?? plans.error}
            retry={() => {
              void company.refetch();
              void plans.refetch();
            }}
          />
        ) : (
          <Skeleton active paragraph={{ rows: 2 }} />
        )}
      </PageSection>
    );

  function begin(next: "assign" | "minutes") {
    setError(undefined);
    setMode(next);
    setPlanId(c!.planId ?? "");
    setMinutes(null);
    setPrice("");
    setNote("");
    setRequestKey(crypto.randomUUID());
  }
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setRequestKey(crypto.randomUUID());
  };
  const percent = c.allowance
    ? Math.min(100, Math.round((c.usedMinutes / c.allowance) * 100))
    : 0;
  const minutesOk = Boolean(minutes && minutes > 0) && MONEY.test(price);

  return (
    <PageSection
      title="通话服务"
      extra={
        <Space wrap>
          <Button onClick={() => begin("assign")}>
            {c.planId ? "更换套餐" : "开通"}
          </Button>
          <Button
            type="primary"
            disabled={!c.planId}
            onClick={() => begin("minutes")}
          >
            加分钟
          </Button>
        </Space>
      }
    >
      <ReadingPanel className={styles.panel}>
        <div className={styles.lead}>
          <h3>{c.planName ?? "未开通"}</h3>
          <Tag>{c.month.slice(0, 7)}</Tag>
        </div>
        {c.planId ? (
          <>
            <div className={styles.meter}>
              <strong>{c.usedMinutes}</strong>
              <span>{`/ ${c.allowance} 分钟`}</span>
            </div>
            <Progress
              percent={percent}
              showInfo={false}
              status={c.usedMinutes >= c.allowance ? "exception" : "normal"}
            />
            <div className={styles.ledger}>
              <span>{`套餐 ${c.monthlyMinutes} 分钟`}</span>
              <span>{`本月加量 ${c.extraMinutes} 分钟`}</span>
              <span>{`坐席 ${c.seatsEnabled} / ${c.seats}`}</span>
            </div>
          </>
        ) : (
          <p className={styles.detail}>
            未开通时，公司看不到电话外呼，员工也不能拨号。
          </p>
        )}
        {c.additions.length ? (
          <ul className={styles.additions} aria-label="加量记录">
            {c.additions.map((entry) => (
              <li key={`${entry.createdAt}-${entry.minutes}`}>
                <span>
                  {`${entry.month.slice(0, 7)} · +${entry.minutes} 分钟 · ${yuan(entry.price)}`}
                </span>
                <span className={styles.detail}>
                  {`${entry.note || "—"} · ${new Date(entry.createdAt).toLocaleDateString("zh-CN")}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </ReadingPanel>
      <Modal
        open={Boolean(mode)}
        title={mode === "minutes" ? "加分钟" : "开通或更换套餐"}
        okText={mode === "minutes" ? "确认加量" : "保存"}
        cancelText="取消"
        confirmLoading={submit.isPending}
        okButtonProps={{
          disabled:
            mode === "minutes" ? !minutesOk : planId === (c.planId ?? ""),
        }}
        onOk={() => submit.mutate()}
        onCancel={() => {
          if (!submit.isPending) setMode(null);
        }}
        destroyOnHidden
      >
        {mode === "minutes" ? (
          <div className={styles.form}>
            <p className={styles.detail}>
              {`只加到 ${c.month.slice(0, 7)}，下月不结转。`}
            </p>
            <label htmlFor="add-minutes">增加分钟</label>
            <InputNumber
              id="add-minutes"
              min={1}
              max={1_000_000}
              precision={0}
              value={minutes}
              className={styles.wide}
              onChange={edit(setMinutes)}
            />
            <label htmlFor="add-price">收费（元）</label>
            <Input
              id="add-price"
              inputMode="decimal"
              value={price}
              status={price && !MONEY.test(price) ? "error" : undefined}
              onChange={(event) => edit(setPrice)(event.target.value)}
            />
            <label htmlFor="add-note">备注</label>
            <Input
              id="add-note"
              maxLength={200}
              value={note}
              onChange={(event) => edit(setNote)(event.target.value)}
            />
          </div>
        ) : (
          <div className={styles.form}>
            <Select
              aria-label="通话套餐"
              className={styles.wide}
              value={planId}
              onChange={setPlanId}
              options={[
                { value: "", label: "未开通" },
                ...plans.data
                  .filter((plan) => plan.assignable || plan.id === c.planId)
                  .map((plan) => ({
                    value: plan.id,
                    label: `${plan.name} · ${plan.seats} 坐席 · ${plan.monthlyMinutes} 分钟 · ${yuan(plan.monthlyPrice)}/月`,
                  })),
              ]}
            />
            <p className={styles.detail}>
              {`保存后立即生效。套餐坐席少于公司已开的 ${c.seatsEnabled} 个时不能保存。`}
            </p>
          </div>
        )}
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </Modal>
    </PageSection>
  );
}
```

- [ ] **Step 4: 放进公司详情页**

`apps/web/src/app/(platform)/platform/tenants/[tenantId]/page.tsx`：import `CompanyTelephony`（`@/features/platform/telephony/company-telephony`），在 `<CompanyAi tenantId={tenant.id} timeZone={tenant.timezone} />` 下一行加 `<CompanyTelephony tenantId={tenant.id} />`。

- [ ] **Step 5: 确认测试通过**

Run: `pnpm --filter @crm/web exec vitest run src/features/platform && pnpm --filter @crm/web typecheck && pnpm --filter @crm/web exec eslint src/features/platform/telephony "src/app/(platform)"`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features/platform/telephony "apps/web/src/app/(platform)/platform/tenants"
git commit -m "$(cat <<'EOF'
公司详情页加通话服务卡片：开通或换套餐、本月用量、加分钟和加量记录

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 本地假快马加坐席接口，更新文档

**Files:**
- Modify（本地，不提交）：`.local/telephony/fake-kuaima.mjs`
- Rewrite: `docs/integrations/kuaima-telephony.md`
- Modify: `docs/integrations/kuaima-vendor-questions.md`

**Interfaces:**
- Consumes: Task 2 的快马请求格式（表单 `company_id`、`ts`、`sign`；建坐席 `seats` 是 JSON 数组；改坐席 `seats_id`、`nickname`、`mobile`；查坐席 `page`、`limit`、`username`，返回 `data.list[{ id, username, nickname, mobile }]`；`code=1` 成功）。
- Produces: 本机 `127.0.0.1:3199` 上的假快马，Task 13 演练用。

- [ ] **Step 1: 假快马加查、建、改坐席**

`.local/telephony/fake-kuaima.mjs` 整个换成：

```js
// Local stand-in for 快马, for rehearsing the live path without a real line:
// callBind plus the three seat APIs. Answers like the documented API and logs
// only non-secret fields (never sign, app_secret or seat passwords).
import { createServer } from "node:http";
let n = 0;
let nextSeat = 9000;
/** username → { id, username, nickname, mobile } */
const seats = new Map();
const reply = (res, body) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const form = new URLSearchParams(body);
    const at = new Date().toISOString();
    const base = { company_id: form.get("company_id"), signLength: form.get("sign")?.length };
    switch (req.url) {
      case "/api/call/callBind": {
        const bindId = `fake-bind-${Date.now()}-${++n}`;
        console.log(at, req.url, {
          ...base, type: form.get("type"), api_type: form.get("api_type"),
          caller: form.get("caller"), callee: form.get("callee"),
          seats_id: form.get("seats_id"), bindId,
        });
        return reply(res, { code: 1, msg: "", data: { bind_id: bindId } });
      }
      case "/api/company/getSeatsList": {
        const username = form.get("username") ?? "";
        const list = [...seats.values()].filter((seat) => !username || seat.username === username);
        console.log(at, req.url, { ...base, username, found: list.length });
        return reply(res, { code: 1, msg: "", data: { list, total: list.length } });
      }
      case "/api/company/createSeats": {
        let created = null;
        try { created = JSON.parse(form.get("seats") ?? "[]"); } catch {}
        if (!Array.isArray(created)) return reply(res, { code: 0, msg: "seats 参数格式错误" });
        for (const seat of created) {
          if ([...seats.values()].some((s) => s.mobile === seat.mobile && s.username !== seat.username))
            return reply(res, { code: 0, msg: "手机号已被其他坐席使用" });
          seats.set(seat.username, { id: ++nextSeat, username: seat.username, nickname: seat.nickname, mobile: seat.mobile });
        }
        console.log(at, req.url, { ...base, usernames: created.map((s) => s.username) });
        return reply(res, { code: 1, msg: "" });
      }
      case "/api/company/updateSeats": {
        const id = Number(form.get("seats_id"));
        const seat = [...seats.values()].find((s) => s.id === id);
        if (!seat) return reply(res, { code: 0, msg: "坐席不存在" });
        seat.mobile = form.get("mobile") ?? seat.mobile;
        seat.nickname = form.get("nickname") ?? seat.nickname;
        console.log(at, req.url, { ...base, seats_id: id });
        return reply(res, { code: 1, msg: "" });
      }
      default:
        return reply(res, { code: 0, msg: "not found" });
    }
  });
}).listen(3199, "127.0.0.1", () => console.log("fake kuaima on 127.0.0.1:3199"));
```

快速自查（假快马只在本机跑，跑完关掉）：

```bash
node .local/telephony/fake-kuaima.mjs > .local/telephony/logs/fake-kuaima.log 2>&1 &
sleep 1
curl -s -X POST 127.0.0.1:3199/api/company/createSeats --data-urlencode 'seats=[{"username":"cabc","nickname":"测试","mobile":"13900000000","password":"x"}]'
curl -s -X POST 127.0.0.1:3199/api/company/getSeatsList -d 'username=cabc'
kill %1
```

Expected：第一行 `{"code":1,"msg":""}`；第二行 `{"code":1,"msg":"","data":{"list":[{"id":9001,"username":"cabc","nickname":"测试","mobile":"13900000000"}],"total":1}}`。日志里没有 `password`。

- [ ] **Step 2: 重写使用文档**

`docs/integrations/kuaima-telephony.md` 整个换成：

````markdown
# 快马回拨：电话外呼

员工在有权限的业务记录上点电话图标，系统让快马线路先拨员工自己的手机，员工接听后线路再拨给客户。通话结束后，结果自动回到原记录。

平台统一用一个快马账号。平台管理员给公司开通通话套餐，按分钟转售；公司管理员只管给成员开外呼，看不到账号和任何金额。做法和统一 AI 服务一样。

本文说明怎么配置、怎么使用、怎么计费、系统有哪些保护，以及真实打一通需要满足的条件。要问快马客服的问题见 [kuaima-vendor-questions.md](kuaima-vendor-questions.md)。

> 状态：只在本地用模拟线路和本地假快马验证过，还没有用真实线路打过电话。不能把本地验证当作真实线路已通过。

## 平台管理员

### 电话线路（系统设置 → 电话线路）

| 项目       | 说明                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 线路       | 「模拟」：不拨真实电话，直接记为已接通 30 秒，计 1 分钟，进价记 0；正式环境不能选。「快马回拨」：走真实线路。              |
| 企业账号   | 快马的企业 ID 和企业密钥。密钥加密保存，保存后谁都看不到原文；留空表示不修改。                                             |
| 进价       | 每分钟进价、每坐席每月进价，用来算收支。                                                                                   |
| 回调地址   | 点「生成」得到一个带凭据的地址，只显示这一次。复制后发给快马客服，配置为话单推送地址。点「重新生成」后旧地址立即失效。     |
| 线路状态   | 页面写明线路为什么不可用，例如「企业密钥未填写」「服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）」，以及已建的坐席总数。 |

线路不可用时，所有公司的员工都不能拨号，公司那边只看到「平台线路未就绪」。

### 通话套餐（导航 → 通话套餐）

- 套餐包含：名称、坐席数、每月分钟数、月售价。
- 修改套餐立即对所有使用它的公司生效。坐席数不能改到低于任何一家使用它的公司已开的坐席数，保存时会写明是哪几家。
- 有公司在用的套餐不能删除，只能改为「停止分配」。
- 第二个标签「收支」：选月份，每家公司一行，最后一行合计。

| 列   | 怎么算                                                                     |
| ---- | -------------------------------------------------------------------------- |
| 套餐 | 截至该月月底最后使用的套餐；未开通显示「—」                                |
| 分钟 | 该月计费分钟 / 额度（套餐分钟 + 当月加量）                                 |
| 收入 | 该月最后使用的套餐的月售价 + 当月加量收费                                  |
| 成本 | 每通「计费分钟 × 拨号时的进价」之和 + 月底前已建的真实坐席数 × 当前坐席月进价 |
| 毛利 | 收入 − 成本                                                                |

坐席月进价没有按月保存，按当前值计算。

### 公司详情 → 通话服务

- 开通或更换套餐，也可以改回「未开通」。新套餐的坐席数少于这家公司已开的坐席数时不能保存，需要先请公司管理员关掉几位成员的外呼。
- 看本月已用分钟、额度、坐席。
- 加分钟：填分钟数、收费和备注，只加到当月，下月不结转。网络重发只加一次。

## 公司管理员

入口：设置 → 集成 → 电话外呼。平台开通后才出现。

| 块           | 说明                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| 套餐和用量   | 套餐名、本月已用 / 额度分钟、已开坐席 / 上限。只读，不显示金额。                                         |
| 可拨打的号码 | 每张业务表单独选，指定哪些电话或文本字段可以拨打。实际只拨中国大陆手机号（11 位，可带 +86）。            |
| 成员坐席     | 给成员填接听手机，打开「允许外呼」。系统自动在快马建坐席；快马拒绝时原样显示原因，这位成员保持关闭。     |

在这里配置可拨打的字段，不会让员工多看到任何内容：员工能看到哪些记录、哪些字段，仍按原来的权限决定。

## 员工使用

1. 记录页、列表和手机卡片上，允许拨打的手机号旁边有电话图标。图标是灰色时，把鼠标放上去可以看到原因：

   | 原因                             | 说明                         |
   | -------------------------------- | ---------------------------- |
   | 通话线路暂不可用，请联系管理员   | 平台线路没配好               |
   | 本月通话分钟已用完，请联系管理员 | 用量到了套餐分钟加当月加量   |
   | 你还没有外呼坐席，请联系管理员   | 管理员还没给你开外呼         |

   公司没开通时，电话图标和拨号入口都不出现。
2. 点图标后会弹出拨号窗口，显示两个号码：客户电话，和线路先回拨的「我的手机」。点「呼叫」就开始拨。
3. 窗口里直接显示进度和结果：正在回拨你的手机… / 线路没有明确回应，等待结果 / 已接通 · 1 分 05 秒 / 未接通 / 线路拒绝 + 原因。
4. 拨出 1 分钟后还没有结果，可以点「结束这通」。一位成员同一时间只能有一通没结束的电话。
5. 通话结束后可以点「写跟进」。

真实线路打完一通，系统会在记录的「动态」里自动加一条，例如「电话外呼：已接通，通话 42 秒」。记录页的「通话」标签和左侧导航的「通话记录」页列出通话；公司被改回「未开通」后，只要有历史通话，这两处仍然可以查看。

## 计费和提醒

- 每通按通话秒数除以 60 向上取整：61 秒计 2 分钟，60 秒计 1 分钟。只有「已接通」计费；未接通、已结束、待核实、线路拒绝都计 0。
- 同一条话单重复推送、先推录音后推话单，都只计一次。
- 用量要等话单回来才知道。最后剩 1 分钟时如果有几位成员同时在打，实际用量会超出额度；超出部分照实记入，不另外扣费，在收支里能看到。
- 本月用量达到额度的 80% 和 100% 时，给公司的每位管理员各发一次站内通知。每月每档只提醒一次，加分钟后再次越过也不重复。

## 保护措施

- **密钥**：企业密钥和回调凭据用服务器主密钥环（`AI_MODEL_KEYRING`）加密保存，加密结果只对本字段有效。保存后接口不会返回原文。
- **公司看不到钱和账号**：公司侧所有接口不返回金额、进价和平台账号；公司成员直接查平台表也查不到数据。
- **计费在数据库里算**：计费分钟、月用量和额度提醒由数据库触发器写入，应用不能直接改。
- **号码来源**：要拨的客户号码由后端从允许拨打的字段里读取，前端不能指定任意号码。前端带上窗口里显示的两个号码；号码变了就拒绝拨号。
- **不重复拨号**：每次打开拨号窗口都有一个请求编号。网络中断后再点「呼叫」，服务器只返回原来那通电话。拨号超时或看不懂快马的回复，都记为「待核实」，不自动重拨。
- **坐席**：每位成员的坐席账号固定（`c` + 成员 ID 的 SHA-256 前 15 位）。上次建好但没保存成功时，重试会找到并直接使用它，不会重复建。
- **回调校验**：回调必须带正确凭据（网址的 `?token=` 或 `Authorization: Bearer`），错了返回 401。话单号查不到对应公司返回 404；主叫、被叫、坐席号和拨号时不一致返回 403。
- **录音链接**：只接受公网 HTTPS 地址。
- **日志**：请求日志不记录网址里的参数，回调凭据不会出现在日志里。

## 回调接口（给快马客服配置）

```
POST {API_ORIGIN}/api/v1/telephony/hooks?token={凭据}
```

所有公司共用这一个地址。完整地址在平台「电话线路」页点「生成」后显示，直接复制即可。收到推送后返回 `{"code":0}`。请求体用 JSON 或表单都可以。

| 推送                                  | 系统处理                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| 话单 `push_type=1`，`status=1` 或 `0` | 记为已接通或未接通，同时记下时长和开始、结束时间（按北京时间解析） |
| 录音 `push_type=2`，带 `audio_url`    | 给这通电话附上录音，不改变接通结果                                 |
| 挂断 `{bind_id, status:"End", time}`  | 如果电话还没出结果，记为已结束；之后再收到话单，仍按话单更新结果   |

## 服务器配置

| 变量                      | 默认值  | 说明                                                                                                  |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `TELEPHONY_LIVE_ENABLED`  | `false` | 设为 `true` 才会真正调用快马的拨号和坐席接口                                                          |
| `AI_MODEL_KEYRING`        | 已有    | 用来加密企业密钥和回调凭据                                                                            |
| `TELEPHONY_KUAIMA_ORIGIN` | 空      | 只用于本地演练：把快马请求转给本机的假快马。正式环境、或者地址不是 localhost / 127.0.0.1 时，一律忽略 |

数据库迁移：`0066_tenant_telephony`，只新增表、函数和触发器，并给站内通知加两种类型，不改动现有业务数据。

## 真实打一通的条件

1. **回调地址必须是公网 HTTPS，快马的服务器能访问到。** 正式环境 `https://crm.baijiehub.com` 满足这个条件。
2. **请求从我们的服务器发出。** 如果快马要求 IP 白名单，要把正式服务器的公网 IP `62.234.18.169` 加进去。
3. **服务器时间要准。** 签名里的时间戳与快马服务器相差不能超过 10 秒。
4. **部署。** 合并后发布到正式环境，执行迁移 0066（之前的迁移没执行的也一起执行）。测试期间设置 `TELEPHONY_LIVE_ENABLED=true`。
5. **快马后台。** 企业 API 已开通，有可用套餐和号码池；回调地址已由客服配置好；新坐席的手机是否要另加白名单，按快马的回答处理。快马后台只由用户本人登录。
6. **密钥。** 聊天里出现过的快马密钥，上线前请快马重置，新密钥只在平台「电话线路」页填写。
7. **测试方式。** 企业 ID 和密钥通过安全输入框提供；被叫号码由用户明确授权；只打一通。要确认的结果：坐席自动建好；员工手机先响，接听后接通客户；话单回来后记录页显示已接通和时长，公司用量增加相应分钟。
````

- [ ] **Step 3: 补问快马客服的问题**

`docs/integrations/kuaima-vendor-questions.md`：在「**四、计费与测试**」第 15 条后面、`谢谢！` 前面加：

```markdown
**五、平台统一账号和坐席**

16. 发给我们的 appkey 和 appSecret，是否就是接口文档里的 `company_id` 和 `app_secret`？`company_id` 应该是数字吗？
17. 通话怎么计费：回拨时打员工手机、打客户两段是否都收费？按分钟向上取整吗？未接通收不收费？
18. 坐席是否收月租？能不能删除或停用坐席？
19. 创建坐席时，坐席账号名（username）有什么格式和长度要求？在整个快马平台唯一，还是在我们企业内唯一？我们打算用 16 位的小写字母加数字。
20. 用「创建坐席」接口建的坐席，手机号还需要另外加白名单吗？还是创建时就自动加入？
```

同文件开头那句「对方回答后，把结论补进 kuaima-telephony.md」后面加一句：`第五部分的回答会影响自动建坐席和收支的算法，回答后按回答调整。`

- [ ] **Step 4: 检查格式并提交**

Run: `npx prettier --check docs/integrations/kuaima-telephony.md docs/integrations/kuaima-vendor-questions.md`
Expected: 通过；不通过就 `npx prettier --write` 这两个文件后再查。

```bash
git add docs/integrations/kuaima-telephony.md docs/integrations/kuaima-vendor-questions.md
git commit -m "$(cat <<'EOF'
电话外呼文档：改为平台统一线路，补问快马坐席和计费问题

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: 全量验证、本地演练和汇报

**Files:**
- Modify: `docs/integrations/kuaima-telephony.md`（加「本地验证记录」）
- 本地（不提交）：`.local/telephony/pw/platform-rehearsal.mjs`、`.local/telephony/PROGRESS.md`、截图 `.local/telephony/shots/`

**Interfaces:**
- Consumes: 前面所有任务。

- [ ] **Step 1: 自动化检查全部跑一遍**

```bash
pnpm --filter @crm/contracts build
pnpm contracts:check
pnpm typecheck
# 和 CI 一样的 lint：API 生产代码（不含 spec）和网页
pnpm --filter @crm/api exec eslint 'src/**/*.ts' --ignore-pattern '**/*.spec.ts'
pnpm --filter @crm/web lint
# 这次新增或改过的测试文件单独查
pnpm --filter @crm/api exec eslint src/modules/integrations test/platform-telephony.e2e-spec.ts test/telephony.e2e-spec.ts test/notifications.e2e-spec.ts test/helpers/telephony-fixture.ts
pnpm --filter @crm/api test
pnpm --filter @crm/web test
.local/telephony/run-e2e.sh test/platform-telephony.e2e-spec.ts test/telephony.e2e-spec.ts test/notifications.e2e-spec.ts test/ai-governance-admin.e2e-spec.ts
TEST_DATABASE_ADMIN_URL="postgresql://crm:crm@127.0.0.1:55466/crm_telephony_test_1?schema=public" \
TEST_DATABASE_URL="postgresql://crm_app:crm_app@127.0.0.1:55466/crm_telephony_test_1?schema=public" \
  pnpm --filter @crm/database test:integration
pnpm --filter @crm/web build
```

Expected：全部通过。`contracts:check` 没有差异。`ai-governance-admin.e2e-spec.ts` 和数据库集成测试也要跑，因为 0066 重建了通知类型约束和 `current_member_notifications` 视图。任何一项失败，先按 superpowers:systematic-debugging 查清原因再修，修完从这一步重跑。

- [ ] **Step 2: 重建演练库之前先问用户（必须等同意）**

用中文问用户，原话大意：

> 要在本地演练库 `crm_telephony_review` 里重建电话外呼的表：会删掉之前本地测试时打的几通电话、成员坐席和可拨打字段设置；客户、线索等演示数据不受影响，正式库和 `crm` 库都不碰。可以吗？

没有得到明确同意就停在这里，只汇报 Step 1 的结果。

- [ ] **Step 3: 同意后重建演练库**

```bash
# 先停掉 3111 上的 API（终端里 Ctrl-C，或按 PROGRESS.md 记录的方式停）
psql "postgresql://zhongxu@localhost:5432/crm_telephony_review" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DROP TABLE IF EXISTS telephony_calls, telephony_member_bindings, telephony_settings CASCADE;
DELETE FROM _prisma_migrations WHERE migration_name = '0066_tenant_telephony';
COMMIT;
SQL
DATABASE_ADMIN_URL="postgresql://zhongxu@localhost:5432/crm_telephony_review" pnpm --filter @crm/database exec prisma migrate deploy
psql "postgresql://zhongxu@localhost:5432/crm_telephony_review" -At -c "SELECT count(*) FROM telephony_platform_settings"
```

Expected：`migrate deploy` 显示应用了 `0066_tenant_telephony`；最后一行输出 `1`。

然后照 `.local/telephony/PROGRESS.md` 的方式重启 API（3111）和网页（3110），先保持 `TELEPHONY_LIVE_ENABLED=false`。

- [ ] **Step 4: 模拟线路演练**

用 `.local/telephony/pw/lib.mjs` 的 `platform`、`admin`、`sun` 三个账号，写 `.local/telephony/pw/platform-rehearsal.mjs`（照 `live-rehearsal.mjs` 的写法：`open(who, path)` 登录后打开页面，每一步 `shot()` 截 1440 和 390 两个宽度），依次做并确认：

1. `platform` 打开 `/platform/settings/telephony`：线路为「模拟」，状态「模拟线路」。填每分钟进价 `0.15`、每坐席每月进价 `10`，保存，提示「线路已保存」。
2. `platform` 打开 `/platform/telephony-plans`：新建「演练标准版」，坐席 3、每月分钟 10、月售价 120，列表出现这一行，「使用公司」0 家。
3. `platform` 打开星云科技的公司详情（`/platform/tenants/<id>`，`id` 用 `psql … -At -c "SELECT id FROM tenants WHERE code='nebula-demo'"` 查）：「通话服务」显示「未开通」；点「开通」选「演练标准版」保存，卡片显示 `0 / 10 分钟`、`坐席 0 / 3`。
4. `admin` 打开 `/workspace/nebula-demo/settings`：「集成 → 电话外呼」出现，概览写「演练标准版 · 本月 0 / 10 分钟」。进入电话外呼页：三块都在；在「可拨打的号码」里给线索选上联系电话字段；给孙悦打开外呼，填接听手机 `13900001005`，保存后显示「已建坐席 · 139 0000 1005」，坐席变成「已开 1 / 3」。
5. `sun` 打开线索 #5，点电话图标、点「呼叫」，显示「已接通 · 30 秒」；回到公司详情，已用变成 `1 / 10 分钟`。
6. `platform` 在公司详情点「加分钟」，加 20 分钟、收费 10 元、备注「演练」，卡片显示 `本月加量 20 分钟`，加量记录出现这一条。
7. `platform` 打开「通话套餐 → 收支」：星云科技一行，收入 ¥130.00（120 + 10），模拟线路的分钟成本 ¥0.00，模拟坐席不计坐席成本。
8. `platform` 把公司改回「未开通」：`admin` 的设置里「电话外呼」消失；`sun` 的记录页电话图标消失，但「通话」标签和「通话记录」页仍能看到刚才那一通。最后再把公司开通回「演练标准版」，方便下一步。

- [ ] **Step 5: 本地假快马演练**

```bash
node .local/telephony/fake-kuaima.mjs > .local/telephony/logs/fake-kuaima.log 2>&1 &
```

API 用 `TELEPHONY_LIVE_ENABLED=true TELEPHONY_KUAIMA_ORIGIN=http://127.0.0.1:3199` 重启。脚本继续：

1. `platform` 把线路改成「快马回拨」，企业 ID `local-fake-co`、企业密钥 `local-fake-secret`（假值），保存；点「生成」拿到回调地址（截图前把 `token=` 后面遮住，地址写进 `.local/telephony/state/callback-url`，权限 600），状态变成「快马回拨」。
2. `admin` 的成员坐席里，孙悦显示「未建坐席」（模拟坐席在快马线路下不算）。关掉再打开孙悦的外呼：假快马日志出现 `getSeatsList` 和 `createSeats`，页面显示「已建坐席」。再给赵晨填一个和孙悦相同的手机号并打开外呼：页面显示「快马：手机号已被其他坐席使用」，赵晨保持关闭，列表显示「建坐席失败：手机号已被其他坐席使用」。
3. `sun` 拨号，显示「正在回拨你的手机…」。从假快马日志取 `bindId`，往回调地址推送 `duration: 61` 的话单两次、录音一次，都返回 `{"code":0}`；用错误的 `token` 推送返回 401；用不存在的 `bind_id` 推送返回 404。窗口变成「已接通 · 1 分 01 秒」；公司详情已用分钟加 2。
4. 这时额度是 10 + 20 = 30 分钟，已用 1 + 2 = 3 分钟。再拨一通，推送 `duration: 1260`（21 分钟）的话单，已用变成 24 分钟，正好 80%：`admin` 的通知铃铛出现「本月通话分钟已用到 80%」，点「查看通话用量」打开电话外呼设置页；`sun` 收不到这条通知；同一条话单再推一次，通知不增加。
5. 收支标签里星云科技一行：收入 ¥130.00；成本 = 快马线路的 2 + 21 = 23 分钟 × ¥0.15 + 1 个真实坐席（孙悦；赵晨没建成）× ¥10 = ¥13.45（模拟那一通进价是 0）；毛利 ¥116.55。

演练完：线路改回「模拟」，停掉假快马，API 去掉两个演练变量后重启。

- [ ] **Step 6: 写本地验证记录并提交**

在 `docs/integrations/kuaima-telephony.md` 的「真实打一通的条件」前面加一节「本地验证记录（日期）」，按 Step 1、4、5 的实际结果写：用了哪个库和端口、模拟线路和假快马各验证了什么、端到端测试和单元测试各多少个通过。只写实际看到的结果，没做到的写明没做到。然后：

```bash
npx prettier --write docs/integrations/kuaima-telephony.md
git add docs/integrations/kuaima-telephony.md
git commit -m "$(cat <<'EOF'
电话外呼文档：平台统一线路的本地验证记录

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

更新 `.local/telephony/PROGRESS.md` 和记忆 `telephony-pr70.md`：平台统一线路已在本地完成、PR #94 还没更新、真实外呼仍等快马客服回答。

- [ ] **Step 7: 向用户汇报，等下一步指示**

用中文、说人话，汇报：

- 做了什么（平台线路、通话套餐、开通、自动建坐席、按分钟计费、80% / 100% 提醒、加分钟、收支）；
- 验证结果，附关键截图（平台线路页、通话套餐和收支、公司通话服务卡片、公司设置页三块、员工分钟用完的提示）；
- 还没做的：真实线路没打过；坐席月租、坐席能否删除、坐席账号格式、新坐席的手机要不要另加白名单，都等快马客服回答第五部分；
- 问用户：是否把这些提交推到 PR #94（会更新 PR 描述，PR 描述末尾写 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`）。

没有用户明确同意，不推送、不改 PR、不合并。
