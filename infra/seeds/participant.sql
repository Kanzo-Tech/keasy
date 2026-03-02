-- Minimal participant bootstrap: org, system user, invite token.
-- Idempotent via upsert (ON CONFLICT) with fixed IDs.

INSERT INTO organizations
  (id, name, slug, legal_name, registration_number, country, role, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Keasy Participant', 'keasy', 'Keasy Participant Org', NULL, 'EU', 'participant',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  role = excluded.role,
  name = excluded.name,
  legal_name = excluded.legal_name,
  updated_at = excluded.updated_at;

-- System user — satisfies FK on bootstrap invite token. Cannot authenticate.
INSERT OR IGNORE INTO users
  (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'system@keasy.local', 'System', '', '', 'inactive',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Open invite token — first user joins as admin (reusable).
INSERT OR IGNORE INTO invite_tokens
  (token, org_id, role, created_by, expires_at, created_at)
VALUES
  ('00000000000000000000000000000001', '00000000-0000-0000-0000-000000000001', 'admin',
   '00000000-0000-0000-0000-000000000000', '2099-12-31T00:00:00Z',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
