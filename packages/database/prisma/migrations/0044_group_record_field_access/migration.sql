-- Opt-in configuration only; no existing permission or business row is rewritten.
ALTER TABLE public.object_permissions ADD COLUMN group_field_access jsonb;
ALTER TABLE public.object_permissions ADD CONSTRAINT object_permissions_group_fields_object
CHECK (group_field_access IS NULL OR (subject_type = 'MEMBER' AND jsonb_typeof(group_field_access) = 'object'));

CREATE OR REPLACE FUNCTION public.record_pool_can_protect(target public.records)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE actor public.tenant_members; snapshot jsonb; access jsonb; title_access text; title_key text; group_fields jsonb;
BEGIN
  SELECT m.* INTO actor FROM public.tenant_members m JOIN public.users u ON u.id=m.user_id
  WHERE m.tenant_id=target.tenant_id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid AND m.status='ACTIVE' AND u.status='ACTIVE';
  IF NOT FOUND OR target.tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id',true),'')::uuid THEN RETURN false; END IF;
  SELECT p.configuration INTO snapshot FROM public.object_definitions o JOIN public.object_publications p ON p.tenant_id=o.tenant_id AND p.id=o.active_publication_id AND p.object_id=o.id
  WHERE o.tenant_id=target.tenant_id AND o.id=target.object_id AND o.status='ACTIVE' AND o.deleted_at IS NULL;
  IF snapshot IS NULL THEN RETURN false; END IF;
  IF actor.role='TENANT_ADMIN' THEN RETURN true; END IF;
  IF snapshot->'employeeAccess' IS NULL THEN RETURN false; END IF;
  SELECT jsonb_build_object('canRead',p.can_read,'canUpdate',p.can_update,'readScope',p.read_scope,'updateScope',p.update_scope) INTO access FROM public.object_permissions p
  WHERE p.tenant_id=target.tenant_id AND p.object_id=target.object_id AND p.subject_type='MEMBER' AND p.subject_member_id=actor.id LIMIT 1;
  SELECT p.group_field_access INTO group_fields FROM public.object_permissions p
  WHERE p.tenant_id=target.tenant_id AND p.object_id=target.object_id AND p.subject_type='MEMBER' AND p.subject_member_id=actor.id LIMIT 1;
  access := COALESCE(access,snapshot->'employeeAccess');
  title_key := snapshot->'object'->>'titleFieldKey';
  SELECT permission.access::text INTO title_access FROM public.member_field_permissions permission JOIN public.field_definitions field ON field.tenant_id=permission.tenant_id AND field.id=permission.field_id
  WHERE permission.tenant_id=target.tenant_id AND permission.object_id=target.object_id AND permission.member_id=actor.id AND field.field_key=title_key;
  title_access := COALESCE(title_access,snapshot->'employeeAccess'->'fields'->>title_key,'EDIT');
  IF group_fields IS NOT NULL AND access->>'readScope'='GROUP' AND NOT target.in_public_pool
     AND target.owner_member_id IS DISTINCT FROM actor.id AND EXISTS (
       SELECT 1 FROM public.member_groups g JOIN public.tenant_members owner ON owner.tenant_id=g.tenant_id AND owner.group_id=g.id AND owner.role='EMPLOYEE'
       WHERE g.tenant_id=actor.tenant_id AND g.id=actor.group_id AND g.leader_member_id=actor.id AND owner.id=target.owner_member_id
     ) THEN
    title_access := COALESCE(group_fields->>title_key, CASE WHEN title_access='HIDDEN' THEN 'HIDDEN' ELSE 'READ_ONLY' END);
  END IF;
  IF EXISTS (SELECT 1 FROM public.field_definitions f WHERE f.tenant_id=target.tenant_id AND f.object_id=target.object_id AND f.field_key=title_key AND f.status='INACTIVE') THEN RETURN false; END IF;
  RETURN COALESCE((access->>'canRead')::boolean,false) AND COALESCE((access->>'canUpdate')::boolean,false)
    AND access->>'readScope' IN ('ALL','OWN','GROUP') AND access->>'updateScope' IN ('ALL','OWN') AND title_access<>'HIDDEN'
    AND (
      access->>'readScope'='ALL'
      -- GROUP always includes self; a former leader falls back to OWN.
      OR COALESCE(target.owner_member_id=actor.id,false)
      OR (access->>'readScope'='GROUP' AND actor.role='EMPLOYEE' AND EXISTS (
        SELECT 1 FROM public.member_groups g
        JOIN public.tenant_members owner ON owner.tenant_id=g.tenant_id AND owner.group_id=g.id AND owner.role='EMPLOYEE'
        WHERE g.tenant_id=actor.tenant_id AND g.id=actor.group_id AND g.leader_member_id=actor.id
          AND owner.id=target.owner_member_id
        -- Disabled group owners remain visible, matching resolveGroupOwnerMembers.
      ))
    )
    AND (access->>'updateScope'='ALL' OR target.owner_member_id=actor.id);
END;
$function$;
