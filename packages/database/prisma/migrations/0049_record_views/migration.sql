BEGIN;

CREATE TYPE public."ViewScope" AS ENUM ('DEFAULT', 'PERSONAL', 'SHARED');

ALTER TABLE public.view_definitions
  ADD COLUMN scope public."ViewScope" NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN owner_member_id uuid,
  ADD COLUMN filter_rule jsonb NOT NULL DEFAULT '{"version":1,"match":"all","conditions":[]}',
  ADD COLUMN column_widths jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN query_options jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN revision integer NOT NULL DEFAULT 1;

-- The designer has always written code=default. Preserve other legacy rows,
-- if present, with their existing tenant-wide visibility.
UPDATE public.view_definitions SET scope = 'SHARED' WHERE code <> 'default';

ALTER TABLE public.view_definitions
  ADD CONSTRAINT view_definitions_tenant_id_owner_member_id_fkey
    FOREIGN KEY (tenant_id, owner_member_id) REFERENCES public.tenant_members (tenant_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT view_definitions_scope_shape CHECK (
    (scope = 'DEFAULT') = (code = 'default') AND
    (scope = 'PERSONAL') = (owner_member_id IS NOT NULL)
  ),
  ADD CONSTRAINT view_definitions_revision_positive CHECK (revision > 0);

-- Keep one provisioning path for the upgrade and subsequent publications.
-- JSON null means that a view inherits the current published columns or sort.
CREATE FUNCTION public.ensure_record_view_presets(target_tenant uuid, target_object uuid)
RETURNS void LANGUAGE sql SET search_path = pg_catalog AS $$
  INSERT INTO public.view_definitions
    (tenant_id, object_id, scope, code, name, filter_rule, column_field_keys, sort, updated_at)
  SELECT target_tenant, target_object, 'SHARED', preset.code, preset.name,
    jsonb_build_object('version', 1, 'match', 'all', 'conditions', preset.conditions),
    'null'::jsonb, 'null'::jsonb, CURRENT_TIMESTAMP
  FROM (VALUES
    ('all', '全部（按权限）', '[]'::jsonb),
    ('my_records', '我负责的', '[{"fieldKey":"$owner","operator":"in","value":["$me"]}]'::jsonb),
    ('today_follow_up', '今天待跟进', '[{"fieldKey":"$followUp","operator":"dueThroughToday"}]'::jsonb)
  ) AS preset(code, name, conditions)
  ON CONFLICT (tenant_id, object_id, code) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.ensure_record_view_presets(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_record_view_presets(uuid, uuid) TO crm_app;

SELECT public.ensure_record_view_presets(tenant_id, id)
FROM public.object_definitions
WHERE active_publication_id IS NOT NULL AND deleted_at IS NULL;

CREATE FUNCTION public.provision_published_record_views() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.ensure_record_view_presets(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.provision_published_record_views() FROM PUBLIC;
CREATE TRIGGER provision_published_record_views
AFTER UPDATE OF active_publication_id ON public.object_definitions
FOR EACH ROW WHEN (
  NEW.active_publication_id IS NOT NULL AND
  OLD.active_publication_id IS DISTINCT FROM NEW.active_publication_id
)
EXECUTE FUNCTION public.provision_published_record_views();

-- Read account and membership state with the caller's privileges. Template
-- installation runs before a company has a member and only inserts DEFAULT.
CREATE FUNCTION public.record_view_access(
  target_tenant uuid, view_scope public."ViewScope", view_owner uuid, operation text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT target_tenant = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.users AS account
      LEFT JOIN public.tenant_members AS member
        ON member.user_id = account.id AND member.tenant_id = target_tenant AND member.status = 'ACTIVE'
      WHERE account.id = NULLIF(current_setting('app.user_id', true), '')::uuid AND account.status = 'ACTIVE'
        AND (
          (view_scope = 'DEFAULT' AND operation IN ('read', 'insert') AND account.is_platform_admin)
          OR (member.id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.tenants AS tenant WHERE tenant.id = target_tenant AND tenant.status = 'ACTIVE'
          ) AND CASE WHEN view_scope = 'PERSONAL' THEN member.id = view_owner
                     ELSE operation = 'read' OR member.role = 'TENANT_ADMIN' END)
        )
    );
$$;
REVOKE ALL ON FUNCTION public.record_view_access(uuid, public."ViewScope", uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_view_access(uuid, public."ViewScope", uuid, text) TO crm_app;

DROP POLICY view_definitions_tenant_access ON public.view_definitions;
CREATE POLICY record_views_read ON public.view_definitions FOR SELECT TO crm_app
USING (public.record_view_access(tenant_id, scope, owner_member_id, 'read'));
CREATE POLICY record_views_insert ON public.view_definitions FOR INSERT TO crm_app
WITH CHECK (
  public.record_view_access(tenant_id, scope, owner_member_id, 'insert')
  AND (scope = 'DEFAULT' OR EXISTS (
    SELECT 1 FROM public.object_definitions obj
    WHERE obj.tenant_id = view_definitions.tenant_id AND obj.id = view_definitions.object_id
      AND obj.active_publication_id IS NOT NULL AND obj.status = 'ACTIVE' AND obj.deleted_at IS NULL
  ))
);
CREATE POLICY record_views_update ON public.view_definitions FOR UPDATE TO crm_app
USING (public.record_view_access(tenant_id, scope, owner_member_id, 'update'))
WITH CHECK (public.record_view_access(tenant_id, scope, owner_member_id, 'update'));
-- Named views archive through status; only the designer removes rows when
-- deleting an unpublished object.
CREATE POLICY record_views_delete ON public.view_definitions FOR DELETE TO crm_app
USING (scope = 'DEFAULT' AND public.record_view_access(tenant_id, scope, owner_member_id, 'delete'));

REVOKE UPDATE ON public.view_definitions FROM crm_app;
GRANT UPDATE (name, column_field_keys, sort, status, filter_rule, column_widths, query_options, revision, updated_at)
ON public.view_definitions TO crm_app;

CREATE INDEX record_follow_ups_open_record_due_idx
ON public.record_follow_ups (tenant_id, record_id, status, due_at)
WHERE status = 'OPEN';

COMMIT;
