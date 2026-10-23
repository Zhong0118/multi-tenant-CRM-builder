-- General work tasks: assigned to a member, not tied to any business record,
-- so ordinary daily work needs no stand-in customer. Customer follow-ups stay
-- in record_follow_ups.
CREATE TABLE public.work_tasks (
  id UUID PRIMARY KEY DEFAULT crm_uuid_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  assignee_member_id UUID NOT NULL,
  created_by_member_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) > 0),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  due_at TIMESTAMPTZ(3) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
  result TEXT NOT NULL DEFAULT '' CHECK (char_length(result) <= 4000),
  completed_at TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'DONE') = (completed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, assignee_member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by_member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX work_tasks_tenant_assignee_status_due_idx
  ON public.work_tasks (tenant_id, assignee_member_id, status, due_at);
CREATE INDEX work_tasks_tenant_completed_idx
  ON public.work_tasks (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON public.work_tasks TO crm_app;
ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY work_tasks_tenant_access ON public.work_tasks TO crm_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- One lightweight report per member and work date (the company's calendar
-- day). Narrative only: counts shown beside it are read from the activity and
-- task tables, never from the report, so nothing is counted twice.
CREATE TABLE public.daily_reports (
  id UUID PRIMARY KEY DEFAULT crm_uuid_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL,
  work_date DATE NOT NULL,
  plans TEXT NOT NULL DEFAULT '' CHECK (char_length(plans) <= 4000),
  completed TEXT NOT NULL DEFAULT '' CHECK (char_length(completed) <= 4000),
  problems TEXT NOT NULL DEFAULT '' CHECK (char_length(problems) <= 4000),
  next_steps TEXT NOT NULL DEFAULT '' CHECK (char_length(next_steps) <= 4000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, member_id, work_date),
  FOREIGN KEY (tenant_id, member_id) REFERENCES public.tenant_members(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX daily_reports_tenant_date_idx ON public.daily_reports (tenant_id, work_date);
GRANT SELECT, INSERT, UPDATE ON public.daily_reports TO crm_app;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_reports_tenant_access ON public.daily_reports TO crm_app
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
