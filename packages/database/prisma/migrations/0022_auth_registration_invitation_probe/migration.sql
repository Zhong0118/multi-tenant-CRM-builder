-- Narrow pre-auth lookup: reveal only whether an unexpired invitation exists
-- for the normalized phone. All callers remain ordinary crm_app sessions.
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
      AND (
        invitation.target_user_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.users AS invited_user
          WHERE invited_user.id = invitation.target_user_id
            AND invited_user.phone = requested_phone
            AND invited_user.status = 'ACTIVE'
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.has_pending_registration_invitation(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_pending_registration_invitation(text, timestamptz) TO crm_app;
