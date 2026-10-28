-- Match runtime GROUP reads without changing the independent update scope.
-- Replacing this invoker function preserves its existing grants and changes no records.
CREATE OR REPLACE FUNCTION public.record_pool_can_protect(target public.records)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
DECLARE actor public.tenant_members; snapshot jsonb; access jsonb; title_access text; title_key text;
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
  access := COALESCE(access,snapshot->'employeeAccess');
  title_key := snapshot->'object'->>'titleFieldKey';
  SELECT permission.access::text INTO title_access FROM public.member_field_permissions permission JOIN public.field_definitions field ON field.tenant_id=permission.tenant_id AND field.id=permission.field_id
  WHERE permission.tenant_id=target.tenant_id AND permission.object_id=target.object_id AND permission.member_id=actor.id AND field.field_key=title_key;
  title_access := COALESCE(title_access,snapshot->'employeeAccess'->'fields'->>title_key,'EDIT');
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
