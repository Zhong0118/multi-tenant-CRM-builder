-- New groups are opt-in. Existing members, records and permissions retain their values.
ALTER TYPE "DataScope" ADD VALUE 'GROUP';
CREATE TABLE public.member_groups (
 id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
 leader_member_id uuid,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (tenant_id,id),
 UNIQUE (tenant_id,name),
 FOREIGN KEY (tenant_id,leader_member_id) REFERENCES public.tenant_members(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.tenant_members ADD COLUMN group_id uuid;
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_group_fkey
 FOREIGN KEY (tenant_id,group_id) REFERENCES public.member_groups(tenant_id,id) ON DELETE RESTRICT;
CREATE INDEX tenant_members_tenant_id_group_id_idx ON public.tenant_members(tenant_id,group_id);
ALTER TABLE public.member_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_groups FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_groups TO crm_app;
CREATE POLICY member_groups_tenant_access ON public.member_groups TO crm_app
 USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
 WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- GROUP expands only an explicitly authorized member's read scope, never writes/defaults.
ALTER TABLE public.object_permissions ADD CONSTRAINT object_permissions_group_read_only
 CHECK (update_scope::text <> 'GROUP' AND (read_scope::text <> 'GROUP' OR subject_type::text = 'MEMBER'));
