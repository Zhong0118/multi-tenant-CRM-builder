BEGIN;
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE NULLIF(btrim(email), '') IS NOT NULL
             GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Conflicting normalized email addresses; resolve account ownership before migrating';
  END IF;
END $$;
UPDATE users SET email = NULLIF(lower(btrim(email)), '')
 WHERE email IS DISTINCT FROM NULLIF(lower(btrim(email)), '');
ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz(3),
  ADD COLUMN email_undeliverable_at timestamptz(3),
  ADD COLUMN email_version integer NOT NULL DEFAULT 0,
  ADD COLUMN new_device_mail_enabled boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT users_email_normalized CHECK (email IS NULL OR (email <> '' AND email = lower(btrim(email))));
-- users_email_key already enforces uniqueness on normalized values.
CREATE TABLE email_challenges (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(12) NOT NULL CHECK (purpose IN ('BIND','CHANGE','REVERIFY','RESET')),
  email_digest char(64) NOT NULL, email_version integer NOT NULL, code_hash char(64) NOT NULL,
  status varchar(12) NOT NULL CHECK (status IN ('SENDING','ACTIVE','CONSUMED','DISCARDED','LOCKED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  created_at timestamptz(3) NOT NULL DEFAULT now(), expires_at timestamptz(3) NOT NULL, consumed_at timestamptz(3)
);
CREATE INDEX email_challenges_owner_target_idx ON email_challenges(user_id, purpose, email_digest);
CREATE INDEX email_challenges_expires_at_idx ON email_challenges(expires_at);
CREATE TABLE login_devices (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash char(64) NOT NULL,
  device varchar(64), network varchar(64), last_used_at timestamptz(3) NOT NULL, expires_at timestamptz(3) NOT NULL,
  PRIMARY KEY(user_id,token_hash)
);
CREATE INDEX login_devices_last_used_at_idx ON login_devices(user_id,last_used_at);
ALTER TABLE email_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_challenges_owner ON email_challenges TO crm_app
  USING (user_id = nullif(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY login_devices_owner ON login_devices TO crm_app
  USING (user_id = nullif(current_setting('app.user_id',true),'')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id',true),'')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON email_challenges, login_devices TO crm_app;
COMMIT;
