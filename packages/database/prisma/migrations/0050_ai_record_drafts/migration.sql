BEGIN;

CREATE UNIQUE INDEX object_publications_tenant_object_id_key ON public.object_publications (tenant_id, object_id, id);

CREATE TABLE public.ai_record_drafts (
  id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  member_id uuid NOT NULL,
  object_id uuid NOT NULL,
  record_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  expected_version integer NOT NULL CHECK (expected_version > 0),
  request_id uuid NOT NULL,
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 4000),
  output jsonb,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  FOREIGN KEY (tenant_id, member_id) REFERENCES public.tenant_members(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, object_id) REFERENCES public.object_definitions(tenant_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, object_id, record_id) REFERENCES public.records(tenant_id, object_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, object_id, publication_id) REFERENCES public.object_publications(tenant_id, object_id, id) ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (tenant_id, id, member_id),
  CONSTRAINT ai_record_drafts_owner_request_key UNIQUE (tenant_id, member_id, record_id, request_id)
);
ALTER TABLE public.ai_record_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_record_drafts FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.ai_record_drafts TO crm_app;
GRANT UPDATE (output, updated_at) ON public.ai_record_drafts TO crm_app;
CREATE POLICY ai_record_drafts_owner_access ON public.ai_record_drafts TO crm_app
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid AND EXISTS (
  SELECT 1 FROM public.tenant_members m
  JOIN public.users u ON u.id = m.user_id AND u.status = 'ACTIVE'
  WHERE m.tenant_id = ai_record_drafts.tenant_id AND m.id = ai_record_drafts.member_id AND m.status = 'ACTIVE'
    AND m.user_id = NULLIF(current_setting('app.user_id', true),'')::uuid
));

ALTER TABLE public.ai_operations
  ALTER COLUMN conversation_id DROP NOT NULL,
  ALTER COLUMN turn_id DROP NOT NULL,
  ADD COLUMN draft_id uuid,
  ADD COLUMN draft_item_key varchar(16),
  ADD FOREIGN KEY (tenant_id, draft_id, requested_by_member_id) REFERENCES public.ai_record_drafts(tenant_id, id, member_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD UNIQUE (tenant_id, draft_id, draft_item_key),
  ADD CONSTRAINT ai_operation_parent CHECK (
    (conversation_id IS NOT NULL AND turn_id IS NOT NULL AND draft_id IS NULL AND draft_item_key IS NULL)
    OR (conversation_id IS NULL AND turn_id IS NULL AND draft_id IS NOT NULL AND draft_item_key IS NOT NULL AND (
      (draft_item_key = 'note' AND operation_type = 'ADD_ACTIVITY_NOTE')
      OR (draft_item_key = 'followUp' AND operation_type = 'CREATE_FOLLOW_UP')
      OR (draft_item_key = 'fields' AND operation_type = 'UPDATE_RECORD')
    ))
  );

-- Existing chat policy remains scoped to its non-deleted conversation.
CREATE POLICY ai_operations_draft_owner ON public.ai_operations TO crm_app
USING (draft_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.ai_record_drafts d WHERE d.tenant_id = ai_operations.tenant_id
    AND d.id = ai_operations.draft_id AND d.member_id = ai_operations.requested_by_member_id
))
WITH CHECK ((confirmed_by_member_id IS NULL OR confirmed_by_member_id = requested_by_member_id) AND EXISTS (
  SELECT 1 FROM public.ai_record_drafts d WHERE d.tenant_id = ai_operations.tenant_id
    AND d.id = ai_operations.draft_id AND d.member_id = ai_operations.requested_by_member_id
    AND d.expected_version = ai_operations.expected_version AND d.publication_id = ai_operations.expected_publication_id
    AND d.expires_at = ai_operations.expires_at
));

REVOKE UPDATE ON public.ai_operations FROM crm_app;
GRANT UPDATE (status, confirmed_by_member_id, confirmed_at, executed_at, updated_at, display_changes_json,
  proposal_json, result_json, audit_id, failure_code) ON public.ai_operations TO crm_app;

-- A logical draft item can be retried while unsuccessful. Its successful
-- business result and audit are immutable under the runtime role.
CREATE POLICY ai_operations_executed_draft_immutable ON public.ai_operations AS RESTRICTIVE
FOR UPDATE TO crm_app USING (draft_id IS NULL OR status <> 'EXECUTED') WITH CHECK (true);

COMMIT;
