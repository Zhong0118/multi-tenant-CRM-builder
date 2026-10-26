CREATE TABLE public.work_goal_rules (
 id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 metric varchar(32) NOT NULL CHECK (metric IN ('calls','connectedCalls','wechatAdded','customersFollowed','followUpsDone','tasksDone')),
 target integer NOT NULL CHECK (target BETWEEN 1 AND 100000),
 remind_at varchar(5) NOT NULL DEFAULT '17:00' CHECK (remind_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 weekdays integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5] CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7] AND array_position(weekdays,NULL) IS NULL),
 audience varchar(32) NOT NULL CHECK (audience IN ('ALL_EMPLOYEES','SELECTED_MEMBERS')),
 enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (tenant_id,metric), UNIQUE (tenant_id,id)
);
CREATE TABLE public.work_goal_recipients (
 tenant_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 member_id uuid NOT NULL,
 PRIMARY KEY (tenant_id,rule_id,member_id),
 FOREIGN KEY (tenant_id,rule_id) REFERENCES public.work_goal_rules(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,member_id) REFERENCES public.tenant_members(tenant_id,id) ON DELETE CASCADE
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.work_goal_rules,public.work_goal_recipients TO crm_app;
ALTER TABLE public.work_goal_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_goal_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.work_goal_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_goal_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY work_goal_rules_tenant ON public.work_goal_rules TO crm_app
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY work_goal_recipients_tenant ON public.work_goal_recipients TO crm_app
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

-- Invoker rights: API calls retain ordinary tenant RLS; the restricted scanner
-- has explicit read policies on the same source tables. This is the single
-- definition used by team statistics, live goals and reminder snapshots.
CREATE FUNCTION public.count_member_goal_work(p_tenant uuid,p_from timestamptz,p_to timestamptz,p_members uuid[] DEFAULT NULL)
 RETURNS TABLE(member_id uuid,metric text,actual integer)
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $function$
 WITH activities AS (
  SELECT a.* FROM public.record_activities a WHERE a.tenant_id=p_tenant AND a.actor_member_id IS NOT NULL
   AND (p_members IS NULL OR a.actor_member_id=ANY(p_members))
 ), counts AS (
  SELECT actor_member_id AS member_id,'calls'::text AS metric,count(*)::int AS actual FROM activities
   WHERE activity_type='CALL' AND created_at>=p_from AND created_at<p_to GROUP BY 1
  UNION ALL
  SELECT actor_member_id,'connectedCalls',count(*)::int FROM activities
   WHERE activity_type='CALL' AND result_key='CONNECTED' AND created_at>=p_from AND created_at<p_to GROUP BY 1
  UNION ALL
  SELECT actor_member_id,'wechatAdded',count(*)::int FROM (
   SELECT actor_member_id,record_id,min(created_at) AS first_at FROM activities WHERE result_key='WECHAT_ADDED' GROUP BY 1,2
  ) pairs WHERE first_at>=p_from AND first_at<p_to GROUP BY 1
  UNION ALL
  SELECT a.actor_member_id,'customersFollowed',count(DISTINCT a.record_id)::int FROM activities a
   JOIN public.records r ON r.tenant_id=a.tenant_id AND r.id=a.record_id
   JOIN public.object_definitions o ON o.tenant_id=r.tenant_id AND o.id=r.object_id
   WHERE a.created_at>=p_from AND a.created_at<p_to AND a.activity_type IN ('CALL','MESSAGE','MEETING') AND o.pool_enabled GROUP BY 1
  UNION ALL
  SELECT f.assignee_member_id,'followUpsDone',count(*)::int FROM public.record_follow_ups f
   JOIN public.records r ON r.tenant_id=f.tenant_id AND r.id=f.record_id
   WHERE f.tenant_id=p_tenant AND r.deleted_at IS NULL AND f.status='DONE' AND f.completed_at>=p_from AND f.completed_at<p_to
    AND (p_members IS NULL OR f.assignee_member_id=ANY(p_members)) GROUP BY 1
  UNION ALL
  SELECT t.assignee_member_id,'tasksDone',count(*)::int FROM public.work_tasks t
   WHERE t.tenant_id=p_tenant AND t.status='DONE' AND t.completed_at>=p_from AND t.completed_at<p_to
    AND (p_members IS NULL OR t.assignee_member_id=ANY(p_members)) GROUP BY 1
 ) SELECT * FROM counts;
$function$;
REVOKE ALL ON FUNCTION public.count_member_goal_work(uuid,timestamptz,timestamptz,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_member_goal_work(uuid,timestamptz,timestamptz,uuid[]) TO crm_app,crm_notification_writer;

ALTER TABLE public.member_notifications ALTER COLUMN object_id DROP NOT NULL, ALTER COLUMN record_id DROP NOT NULL;
ALTER TABLE public.member_notifications DROP CONSTRAINT member_notifications_kind_check;
ALTER TABLE public.member_notifications ADD CONSTRAINT member_notifications_kind_check CHECK (kind IN ('CONTACT_DUE','FOLLOW_UP_DUE','TASK_OVERDUE','POOL_RECLAIMED','PROTECTION_REVIEW','WORK_GOAL_BEHIND'));
ALTER TABLE public.member_notifications ADD COLUMN goal_rule_id uuid, ADD COLUMN goal_date date, ADD COLUMN details jsonb;
ALTER TABLE public.member_notifications ADD FOREIGN KEY (tenant_id,goal_rule_id) REFERENCES public.work_goal_rules(tenant_id,id) ON DELETE CASCADE;
ALTER TABLE public.member_notifications ADD CONSTRAINT member_notifications_goal_shape CHECK (
 (kind='WORK_GOAL_BEHIND' AND object_id IS NULL AND record_id IS NULL AND goal_rule_id IS NOT NULL AND goal_date IS NOT NULL AND details IS NOT NULL AND jsonb_typeof(details)='object')
 OR (kind<>'WORK_GOAL_BEHIND' AND object_id IS NOT NULL AND record_id IS NOT NULL AND goal_rule_id IS NULL AND goal_date IS NULL AND details IS NULL)
);
CREATE UNIQUE INDEX member_notifications_goal_date_key ON public.member_notifications(tenant_id,goal_rule_id,recipient_member_id,goal_date) WHERE kind='WORK_GOAL_BEHIND';

-- Append columns after the existing view columns so CREATE OR REPLACE remains
-- compatible with every existing notification consumer.
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
  n.kind IN ('WORK_GOAL_BEHIND','POOL_RECLAIMED') OR (
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
GRANT SELECT ON public.work_goal_rules,public.work_goal_recipients,public.record_activities,public.work_tasks TO crm_notification_writer;
CREATE POLICY notification_writer_goals ON public.work_goal_rules FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_recipients ON public.work_goal_recipients FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_activities ON public.record_activities FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_work_tasks ON public.work_tasks FOR SELECT TO crm_notification_writer USING (true);
-- users has no RLS. A narrow trigger keeps its locking column grant from
-- becoming an account-write capability for the restricted notification role.
CREATE FUNCTION public.guard_notification_writer_account_update() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
 IF current_user='crm_notification_writer' THEN RAISE EXCEPTION 'notification writer cannot modify accounts'; END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER users_notification_writer_lock_only BEFORE UPDATE OF id ON public.users
 FOR EACH ROW EXECUTE FUNCTION public.guard_notification_writer_account_update();
REVOKE ALL ON FUNCTION public.guard_notification_writer_account_update() FROM PUBLIC;
GRANT UPDATE(id) ON public.work_goal_rules,public.users TO crm_notification_writer;
CREATE POLICY notification_writer_goals_lock ON public.work_goal_rules FOR UPDATE TO crm_notification_writer USING (true) WITH CHECK (false);

-- Fresh validation and row locks are held through insertion. Never wait for
-- business locks: a concurrent edit/disable is skipped until the next scan.
CREATE FUNCTION public.guard_work_goal_notification() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE goal record; n integer; local_now timestamp; day date;
BEGIN
 SELECT g.*,t.timezone INTO goal FROM public.work_goal_rules g
 JOIN public.tenants t ON t.id=g.tenant_id
 JOIN public.tenant_members m ON m.tenant_id=t.id AND m.id=NEW.recipient_member_id
 JOIN public.users u ON u.id=m.user_id
 WHERE g.tenant_id=NEW.tenant_id AND g.id=NEW.goal_rule_id AND g.enabled
  AND t.status='ACTIVE' AND m.status='ACTIVE' AND m.role='EMPLOYEE' AND u.status='ACTIVE'
  AND (g.audience='ALL_EMPLOYEES' OR EXISTS (SELECT 1 FROM public.work_goal_recipients s WHERE s.tenant_id=g.tenant_id AND s.rule_id=g.id AND s.member_id=m.id))
 FOR SHARE OF t,m,u,g SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 local_now:=CURRENT_TIMESTAMP AT TIME ZONE goal.timezone; day:=local_now::date;
 IF NEW.goal_date<>day OR NOT (extract(isodow FROM day)::int=ANY(goal.weekdays)) OR local_now::time<goal.remind_at::time THEN RETURN NULL; END IF;
 SELECT COALESCE(sum(c.actual),0)::int INTO n FROM public.count_member_goal_work(NEW.tenant_id,day::timestamp AT TIME ZONE goal.timezone,(day+1)::timestamp AT TIME ZONE goal.timezone,ARRAY[NEW.recipient_member_id]) c WHERE c.metric=goal.metric;
 IF n>=goal.target THEN RETURN NULL; END IF;
 NEW.details:=jsonb_build_object('date',day::text,'metric',goal.metric,'actual',n,'target',goal.target,'remindAt',goal.remind_at,'timezone',goal.timezone);
 RETURN NEW;
END;
$function$;
CREATE TRIGGER member_notifications_guard_goal BEFORE INSERT ON public.member_notifications
 FOR EACH ROW WHEN (NEW.kind='WORK_GOAL_BEHIND') EXECUTE FUNCTION public.guard_work_goal_notification();

CREATE FUNCTION public.sweep_work_goal_notifications(batch_size integer DEFAULT 500) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE inserted integer; bounded_size integer:=LEAST(GREATEST(COALESCE(batch_size,500),1),5000);
BEGIN
 WITH pending AS (
  SELECT g.tenant_id,g.id AS rule_id,m.id AS member_id,(CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::date AS day
  FROM public.work_goal_rules g JOIN public.tenants t ON t.id=g.tenant_id AND t.status='ACTIVE'
  JOIN public.tenant_members m ON m.tenant_id=t.id AND m.status='ACTIVE' AND m.role='EMPLOYEE'
  JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
  WHERE g.enabled AND extract(isodow FROM CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::int=ANY(g.weekdays)
   AND (CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::time>=g.remind_at::time
   AND (g.audience='ALL_EMPLOYEES' OR EXISTS (SELECT 1 FROM public.work_goal_recipients s WHERE s.tenant_id=g.tenant_id AND s.rule_id=g.id AND s.member_id=m.id))
   AND NOT EXISTS (SELECT 1 FROM public.member_notifications n WHERE n.tenant_id=g.tenant_id AND n.goal_rule_id=g.id AND n.recipient_member_id=m.id AND n.goal_date=(CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::date AND n.kind='WORK_GOAL_BEHIND')
   AND COALESCE((SELECT sum(c.actual) FROM public.count_member_goal_work(g.tenant_id,((CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::date)::timestamp AT TIME ZONE t.timezone,(((CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::date)+1)::timestamp AT TIME ZONE t.timezone,ARRAY[m.id]) c WHERE c.metric=g.metric),0)<g.target
  ORDER BY g.tenant_id,g.id,m.id LIMIT bounded_size FOR SHARE OF g,t,m,u SKIP LOCKED
 )
 INSERT INTO public.member_notifications(tenant_id,recipient_member_id,kind,event_key,goal_rule_id,goal_date,details)
 SELECT tenant_id,member_id,'WORK_GOAL_BEHIND',rule_id::text||':'||day::text,rule_id,day,'{}'::jsonb FROM pending ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT; RETURN inserted;
END;
$function$;
GRANT CREATE ON SCHEMA public TO crm_notification_writer;
ALTER FUNCTION public.sweep_work_goal_notifications(integer) OWNER TO crm_notification_writer;
ALTER FUNCTION public.guard_work_goal_notification() OWNER TO crm_notification_writer;
REVOKE CREATE ON SCHEMA public FROM crm_notification_writer;
REVOKE ALL ON FUNCTION public.sweep_work_goal_notifications(integer),public.guard_work_goal_notification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_work_goal_notifications(integer) TO crm_app;
