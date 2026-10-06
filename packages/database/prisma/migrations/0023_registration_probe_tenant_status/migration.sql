-- Registration bootstrap invitations remain available for DRAFT tenants,
-- while suspended and closed tenants cannot request or complete registration.
GRANT SELECT (id, status) ON public.tenants TO crm_registration_probe;
GRANT SELECT (tenant_id) ON public.tenant_invitations TO crm_registration_probe;

CREATE POLICY tenants_registration_probe ON public.tenants
FOR SELECT TO crm_registration_probe
USING (status IN ('DRAFT', 'ACTIVE'));

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
    JOIN public.tenants AS tenant ON tenant.id = invitation.tenant_id
    WHERE invitation.target_phone = requested_phone
      AND invitation.status = 'PENDING'
      AND invitation.expires_at > checked_at
      AND invitation.target_user_id IS NULL
      AND tenant.status IN ('DRAFT', 'ACTIVE')
  );
$function$;
