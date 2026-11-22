-- Bind question and evidence rows to the owning member AND the assistant message.
CREATE UNIQUE INDEX ai_conversations_question_owner ON ai_conversations(tenant_id,id,created_by_member_id);
CREATE UNIQUE INDEX ai_messages_question_owner ON ai_messages(tenant_id,conversation_id,id,turn_id,role);

CREATE TABLE ai_questions (
  id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
  tenant_id uuid NOT NULL,
  member_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  role "AiMessageRole" NOT NULL DEFAULT 'ASSISTANT' CHECK (role='ASSISTANT'),
  kind varchar(16) NOT NULL CHECK(kind IN ('choose_record','choose_option','fill_fields')),
  state varchar(16) NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','ANSWERED','CANCELLED','SUPERSEDED','EXPIRED')),
  prompt text NOT NULL,
  definition jsonb NOT NULL,
  answer jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamptz(3),
  expires_at timestamptz(3) NOT NULL,
  FOREIGN KEY (tenant_id,conversation_id,member_id)
    REFERENCES ai_conversations(tenant_id,id,created_by_member_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,conversation_id,message_id,turn_id,role)
    REFERENCES ai_messages(tenant_id,conversation_id,id,turn_id,role) ON UPDATE CASCADE ON DELETE CASCADE
);
ALTER TABLE ai_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY member_access ON ai_questions TO crm_app USING (
  tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT 1 FROM ai_conversations c WHERE c.id = ai_questions.conversation_id
    AND c.tenant_id = ai_questions.tenant_id AND c.created_by_member_id = ai_questions.member_id AND c.deleted_at IS NULL
  )
);

CREATE TABLE ai_record_evidence (
  id uuid PRIMARY KEY DEFAULT public.crm_uuid_v7(),
  tenant_id uuid NOT NULL,
  member_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  role "AiMessageRole" NOT NULL DEFAULT 'ASSISTANT' CHECK (role='ASSISTANT'),
  object_code varchar(64) NOT NULL,
  record_id uuid NOT NULL,
  source varchar(8) NOT NULL CHECK(source IN ('tool','page')),
  FOREIGN KEY (tenant_id,conversation_id,member_id)
    REFERENCES ai_conversations(tenant_id,id,created_by_member_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,conversation_id,message_id,turn_id,role)
    REFERENCES ai_messages(tenant_id,conversation_id,id,turn_id,role) ON UPDATE CASCADE ON DELETE CASCADE
);
ALTER TABLE ai_record_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_record_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY member_access ON ai_record_evidence TO crm_app USING (
  tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT 1 FROM ai_conversations c WHERE c.id = ai_record_evidence.conversation_id
    AND c.tenant_id = ai_record_evidence.tenant_id AND c.created_by_member_id = ai_record_evidence.member_id AND c.deleted_at IS NULL
  )
);

GRANT SELECT, INSERT, UPDATE ON ai_questions TO crm_app;
GRANT SELECT, INSERT ON ai_record_evidence TO crm_app;
CREATE UNIQUE INDEX ai_questions_open_per_conversation ON ai_questions(conversation_id) WHERE state='OPEN';
CREATE INDEX ai_questions_message_id_created_at_idx ON ai_questions(message_id,created_at);
CREATE UNIQUE INDEX ai_record_evidence_message_id_object_code_record_id_source_key ON ai_record_evidence(message_id,object_code,record_id,source);
CREATE INDEX ai_record_evidence_conversation_id_object_code_record_id_idx ON ai_record_evidence(conversation_id,object_code,record_id);
