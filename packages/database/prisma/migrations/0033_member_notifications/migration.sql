-- Only notification metadata is stored; existing business rows are untouched.
ALTER TABLE public.records ADD CONSTRAINT records_tenant_object_id_key UNIQUE (tenant_id,object_id,id);
ALTER TABLE public.record_follow_ups ADD CONSTRAINT record_follow_ups_tenant_record_id_key UNIQUE (tenant_id,record_id,id);
CREATE TABLE public.member_notifications (
 id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 recipient_member_id uuid NOT NULL,
 object_id uuid NOT NULL,
 record_id uuid NOT NULL,
 follow_up_id uuid,
 kind varchar(32) NOT NULL CHECK (kind IN ('CONTACT_DUE','FOLLOW_UP_DUE','TASK_OVERDUE','POOL_RECLAIMED','PROTECTION_REVIEW')),
 event_key varchar(200) NOT NULL,
 due_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_xid text NOT NULL DEFAULT pg_current_xact_id()::text,
 read_at timestamptz(3),
 resolved_at timestamptz(3),
 FOREIGN KEY (tenant_id,recipient_member_id) REFERENCES public.tenant_members(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,object_id) REFERENCES public.object_definitions(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,object_id,record_id) REFERENCES public.records(tenant_id,object_id,id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,record_id,follow_up_id) REFERENCES public.record_follow_ups(tenant_id,record_id,id) ON DELETE CASCADE,
 CONSTRAINT member_notifications_event_key UNIQUE (tenant_id,recipient_member_id,kind,event_key),
 CHECK ((kind='TASK_OVERDUE') = (follow_up_id IS NOT NULL)),
 CHECK ((kind IN ('CONTACT_DUE','FOLLOW_UP_DUE','TASK_OVERDUE')) = (due_at IS NOT NULL))
);
CREATE INDEX member_notifications_inbox_idx ON public.member_notifications(tenant_id,recipient_member_id,created_at DESC,id DESC) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX member_notifications_open_review_idx ON public.member_notifications(tenant_id,recipient_member_id,record_id) WHERE kind='PROTECTION_REVIEW' AND resolved_at IS NULL;
ALTER TABLE public.member_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_notifications FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE(read_at) ON public.member_notifications TO crm_app;
CREATE POLICY member_notifications_self ON public.member_notifications TO crm_app
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
  SELECT 1 FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id JOIN public.tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=member_notifications.tenant_id AND m.id=recipient_member_id
    AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
    AND m.status='ACTIVE' AND u.status='ACTIVE' AND t.status='ACTIVE'
 ));

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='crm_notification_writer') THEN
  CREATE ROLE crm_notification_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
ALTER ROLE crm_notification_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO crm_notification_writer;
GRANT SELECT ON public.tenants,public.users,public.tenant_members,public.object_definitions,public.records,public.record_follow_ups,public.member_notifications TO crm_notification_writer;
GRANT INSERT,UPDATE(resolved_at) ON public.member_notifications TO crm_notification_writer;
CREATE POLICY notification_writer_tenants ON public.tenants FOR SELECT TO crm_notification_writer USING (status='ACTIVE');
CREATE POLICY notification_writer_members ON public.tenant_members FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_objects ON public.object_definitions FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_records ON public.records FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_tasks ON public.record_follow_ups FOR SELECT TO crm_notification_writer USING (true);
CREATE POLICY notification_writer_notifications ON public.member_notifications TO crm_notification_writer USING (true) WITH CHECK (true);

-- PostgreSQL requires a column UPDATE grant for row locks. WITH CHECK(false)
-- rejects every actual business UPDATE; this role can only lock these parents.
GRANT UPDATE(id) ON public.tenants,public.tenant_members,public.object_definitions,public.records TO crm_notification_writer;
CREATE POLICY notification_writer_tenants_lock ON public.tenants FOR UPDATE TO crm_notification_writer USING (true) WITH CHECK (false);
CREATE POLICY notification_writer_members_lock ON public.tenant_members FOR UPDATE TO crm_notification_writer USING (true) WITH CHECK (false);
CREATE POLICY notification_writer_objects_lock ON public.object_definitions FOR UPDATE TO crm_notification_writer USING (true) WITH CHECK (false);
CREATE POLICY notification_writer_records_lock ON public.records FOR UPDATE TO crm_notification_writer USING (true) WITH CHECK (false);

-- A scanner may have read the preceding review episode. This separate volatile
-- statement sees fresh state and holds parents through INSERT/transaction end.
-- SKIP LOCKED avoids waiting on business transactions whose existing lock order
-- may differ; a skipped current review is retried by the next minute's sweep.
CREATE FUNCTION public.guard_member_notification_review() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
 PERFORM 1 FROM public.tenants t
 JOIN public.tenant_members m ON m.tenant_id=t.id
 JOIN public.users u ON u.id=m.user_id
 JOIN public.object_definitions o ON o.tenant_id=t.id
 JOIN public.records r ON r.tenant_id=t.id AND r.object_id=o.id
 WHERE t.id=NEW.tenant_id AND t.status='ACTIVE'
  AND m.id=NEW.recipient_member_id AND m.status='ACTIVE' AND m.role='TENANT_ADMIN' AND u.status='ACTIVE'
  AND o.id=NEW.object_id AND o.status='ACTIVE' AND o.deleted_at IS NULL
  AND r.id=NEW.record_id AND r.deleted_at IS NULL AND r.pool_stage='PROTECTED' AND r.protection_needs_review
 FOR SHARE OF t,m,o,r SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER member_notifications_guard_review BEFORE INSERT ON public.member_notifications
 FOR EACH ROW WHEN (NEW.kind='PROTECTION_REVIEW') EXECUTE FUNCTION public.guard_member_notification_review();

-- The view re-evaluates state on every request; the API additionally applies
-- published object/member read permissions and OWN scope before paging/counting.
CREATE VIEW public.current_member_notifications WITH (security_invoker=true) AS
 SELECT n.*,o.code AS object_code,o.name AS object_name,r.record_no,r.owner_member_id AS record_owner_member_id
 FROM public.member_notifications n
 JOIN public.tenants t ON t.id=n.tenant_id AND t.status='ACTIVE'
 JOIN public.tenant_members m ON m.tenant_id=n.tenant_id AND m.id=n.recipient_member_id AND m.status='ACTIVE'
 JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
 JOIN public.object_definitions o ON o.tenant_id=n.tenant_id AND o.id=n.object_id
 JOIN public.records r ON r.tenant_id=n.tenant_id AND r.object_id=n.object_id AND r.id=n.record_id
 LEFT JOIN public.record_follow_ups f ON f.tenant_id=n.tenant_id AND f.record_id=n.record_id AND f.id=n.follow_up_id
 WHERE n.resolved_at IS NULL AND (
  n.kind='POOL_RECLAIMED' OR (
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
GRANT SELECT ON public.current_member_notifications TO crm_app;

CREATE FUNCTION public.sweep_member_notifications(batch_size integer DEFAULT 500) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE inserted integer; bounded_size integer:=LEAST(GREATEST(COALESCE(batch_size,500),1),5000);
BEGIN
 WITH candidates AS (
  SELECT r.tenant_id,r.owner_member_id AS recipient_member_id,r.object_id,r.id AS record_id,NULL::uuid AS follow_up_id,
   CASE WHEN r.pool_stage='PENDING_CONTACT' THEN 'CONTACT_DUE' ELSE 'FOLLOW_UP_DUE' END AS kind,
   r.id::text||':'||extract(epoch FROM r.ownership_expires_at)::text AS event_key,r.ownership_expires_at AS due_at
  FROM public.records r JOIN public.object_definitions o ON o.tenant_id=r.tenant_id AND o.id=r.object_id
  WHERE r.deleted_at IS NULL AND o.status='ACTIVE' AND o.deleted_at IS NULL AND o.pool_enabled AND o.pool_lifecycle_enabled
   AND NOT r.in_public_pool AND r.owner_member_id IS NOT NULL AND r.ownership_expires_at>CURRENT_TIMESTAMP
   AND ((r.pool_stage='PENDING_CONTACT' AND r.ownership_expires_at<=CURRENT_TIMESTAMP+LEAST(interval '2 hours',o.pool_contact_ttl_hours*interval '1 hour'/4))
    OR (r.pool_stage='FOLLOWING' AND r.ownership_expires_at<=CURRENT_TIMESTAMP+LEAST(interval '24 hours',o.pool_follow_up_ttl_hours*interval '1 hour'/4)))
  UNION ALL
  SELECT f.tenant_id,f.assignee_member_id,r.object_id,r.id,f.id,'TASK_OVERDUE',f.id::text||':'||extract(epoch FROM f.due_at)::text,f.due_at
  FROM public.record_follow_ups f JOIN public.records r ON r.tenant_id=f.tenant_id AND r.id=f.record_id
  JOIN public.object_definitions o ON o.tenant_id=r.tenant_id AND o.id=r.object_id
  WHERE f.status='OPEN' AND f.due_at<=CURRENT_TIMESTAMP AND r.deleted_at IS NULL AND o.status='ACTIVE' AND o.deleted_at IS NULL
  UNION ALL
  SELECT r.tenant_id,m.id,r.object_id,r.id,NULL::uuid,'PROTECTION_REVIEW','review:'||r.id::text||':'||public.crm_uuid_v7()::text,NULL::timestamptz
  FROM public.records r JOIN public.object_definitions o ON o.tenant_id=r.tenant_id AND o.id=r.object_id
  JOIN public.tenant_members m ON m.tenant_id=r.tenant_id AND m.role='TENANT_ADMIN'
  WHERE r.pool_stage='PROTECTED' AND r.protection_needs_review AND r.deleted_at IS NULL AND o.status='ACTIVE' AND o.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.member_notifications n WHERE n.tenant_id=r.tenant_id AND n.recipient_member_id=m.id AND n.record_id=r.id AND n.kind='PROTECTION_REVIEW' AND n.resolved_at IS NULL)
 ), pending AS (
  SELECT c.* FROM candidates c JOIN public.tenants t ON t.id=c.tenant_id AND t.status='ACTIVE'
  JOIN public.tenant_members m ON m.tenant_id=c.tenant_id AND m.id=c.recipient_member_id AND m.status='ACTIVE'
  JOIN public.users u ON u.id=m.user_id AND u.status='ACTIVE'
  WHERE NOT EXISTS (SELECT 1 FROM public.member_notifications n WHERE n.tenant_id=c.tenant_id AND n.recipient_member_id=c.recipient_member_id AND n.kind=c.kind AND n.event_key=c.event_key)
  ORDER BY c.due_at NULLS LAST,c.record_id,c.recipient_member_id LIMIT bounded_size
 )
 INSERT INTO public.member_notifications(tenant_id,recipient_member_id,object_id,record_id,follow_up_id,kind,event_key,due_at)
 SELECT tenant_id,recipient_member_id,object_id,record_id,follow_up_id,kind,event_key,due_at FROM pending ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 RETURN inserted;
END;
$function$;

-- Review transitions are atomic with the business event. Clearing the flag
-- closes the entire old episode, including members no longer administrators.
CREATE FUNCTION public.notify_record_protection_review() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE episode text:='review:'||NEW.id::text||':'||public.crm_uuid_v7()::text;
BEGIN
 IF NOT NEW.protection_needs_review THEN
  UPDATE public.member_notifications SET resolved_at=CURRENT_TIMESTAMP
  WHERE tenant_id=NEW.tenant_id AND record_id=NEW.id AND kind='PROTECTION_REVIEW' AND resolved_at IS NULL;
 ELSIF NOT OLD.protection_needs_review AND NEW.pool_stage='PROTECTED' AND NEW.deleted_at IS NULL THEN
  INSERT INTO public.member_notifications(tenant_id,recipient_member_id,object_id,record_id,kind,event_key)
  SELECT NEW.tenant_id,m.id,NEW.object_id,NEW.id,'PROTECTION_REVIEW',episode
  FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id JOIN public.tenants t ON t.id=m.tenant_id
  JOIN public.object_definitions o ON o.tenant_id=NEW.tenant_id AND o.id=NEW.object_id
  WHERE m.tenant_id=NEW.tenant_id AND m.role='TENANT_ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' AND t.status='ACTIVE' AND o.status='ACTIVE' AND o.deleted_at IS NULL
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER records_notify_protection_review AFTER UPDATE OF protection_needs_review ON public.records
 FOR EACH ROW WHEN (OLD.protection_needs_review IS DISTINCT FROM NEW.protection_needs_review) EXECUTE FUNCTION public.notify_record_protection_review();

-- Invoker rights intentionally authenticate the actual reclaimer role. The
-- runtime role can append audits but cannot create receipts by forging one.
GRANT SELECT,INSERT ON public.member_notifications TO crm_pool_reclaimer;
CREATE POLICY notification_reclaimer ON public.member_notifications TO crm_pool_reclaimer
 USING (kind='POOL_RECLAIMED') WITH CHECK (kind='POOL_RECLAIMED');
CREATE FUNCTION public.notify_record_reclaimed() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
BEGIN
 IF current_user<>'crm_pool_reclaimer' THEN RETURN NEW; END IF;
 INSERT INTO public.member_notifications(tenant_id,recipient_member_id,object_id,record_id,kind,event_key)
 SELECT NEW.tenant_id,(NEW."before"->>'ownerMemberId')::uuid,r.object_id,r.id,'POOL_RECLAIMED',NEW.id::text
 FROM public.records r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.resource_id
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$function$;
CREATE TRIGGER audits_notify_record_reclaimed AFTER INSERT ON public.audit_logs
 FOR EACH ROW WHEN (NEW.actor_type='SYSTEM' AND NEW.action='record.ownership_reclaimed' AND NEW.resource_type='record') EXECUTE FUNCTION public.notify_record_reclaimed();

GRANT CREATE ON SCHEMA public TO crm_notification_writer;
ALTER FUNCTION public.sweep_member_notifications(integer) OWNER TO crm_notification_writer;
ALTER FUNCTION public.guard_member_notification_review() OWNER TO crm_notification_writer;
ALTER FUNCTION public.notify_record_protection_review() OWNER TO crm_notification_writer;
REVOKE CREATE ON SCHEMA public FROM crm_notification_writer;
REVOKE ALL ON FUNCTION public.sweep_member_notifications(integer),public.notify_record_protection_review(),public.notify_record_reclaimed(),public.guard_member_notification_review() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_member_notifications(integer) TO crm_app;
