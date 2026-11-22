BEGIN;

-- The default assigns the first slot to historical single-operation turns.
ALTER TABLE public.ai_operations ADD COLUMN item_key integer NOT NULL DEFAULT 1
  CHECK (item_key BETWEEN 1 AND 20);
DROP INDEX public.ai_operations_tenant_id_conversation_id_turn_id_key;
CREATE UNIQUE INDEX ai_operations_tenant_id_conversation_id_turn_id_item_key_key
  ON public.ai_operations (tenant_id, conversation_id, turn_id, item_key);

COMMIT;
