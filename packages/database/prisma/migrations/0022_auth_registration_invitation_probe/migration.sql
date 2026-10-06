-- A dedicated non-login role reads invitations through an explicit SELECT policy;
-- neither crm_app nor the function owner bypasses FORCE RLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_registration_probe') THEN
    CREATE ROLE crm_registration_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE crm_registration_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO crm_registration_probe;
GRANT SELECT (target_phone, status, expires_at, target_user_id) ON public.tenant_invitations TO crm_registration_probe;
CREATE POLICY tenant_invitations_registration_probe ON public.tenant_invitations
FOR SELECT TO crm_registration_probe
USING (status = 'PENDING' AND target_user_id IS NULL);

CREATE OR REPLACE FUNCTION public.has_pending_registration_invitation(
  requested_phone text,
  checked_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_invitations AS invitation
    WHERE invitation.target_phone = requested_phone
      AND invitation.status = 'PENDING'
      AND invitation.expires_at > checked_at
      AND invitation.target_user_id IS NULL
  );
$function$;

GRANT CREATE ON SCHEMA public TO crm_registration_probe;
ALTER FUNCTION public.has_pending_registration_invitation(text, timestamptz) OWNER TO crm_registration_probe;
REVOKE CREATE ON SCHEMA public FROM crm_registration_probe;
REVOKE ALL ON FUNCTION public.has_pending_registration_invitation(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_pending_registration_invitation(text, timestamptz) TO crm_app;
