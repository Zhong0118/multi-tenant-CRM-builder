ALTER TABLE public.object_workflow_definitions
  ADD COLUMN source_template_version_id uuid REFERENCES public.business_template_versions(id) ON DELETE RESTRICT,
  ALTER COLUMN created_by_member_id DROP NOT NULL,
  ALTER COLUMN updated_by_member_id DROP NOT NULL,
  ADD CONSTRAINT object_workflow_author_or_template CHECK (
    source_template_version_id IS NOT NULL OR
    (created_by_member_id IS NOT NULL AND updated_by_member_id IS NOT NULL)
  );
