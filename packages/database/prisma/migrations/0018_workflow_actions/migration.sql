-- Ordered Action steps of a workflow transition (design spec §9, §28).
--
-- `workflow_transition_definitions` already has RLS enabled + forced and the
-- runtime role's grants (0017), and this migration neither adds a table nor
-- changes visibility, so it deliberately carries no policy or GRANT statement.

ALTER TABLE "workflow_transition_definitions"
ADD COLUMN "actions" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "workflow_transition_definitions"
ADD CONSTRAINT "workflow_transition_definitions_actions_array"
CHECK (jsonb_typeof("actions") = 'array');
