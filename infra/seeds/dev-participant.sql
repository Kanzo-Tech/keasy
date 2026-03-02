-- Dev participant seed: bootstrap org + demo data (cloud account, connections, jobs).
-- Users join via invite link — no hardcoded users/memberships.
-- Idempotent via upsert (ON CONFLICT) with fixed IDs.

-- ── Bootstrap (same as participant.sql) ─────────────────────────────────────

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

INSERT OR IGNORE INTO users
  (id, email, first_name, last_name, password_hash, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'system@keasy.local', 'System', '', '', 'inactive',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO invite_tokens
  (token, org_id, role, created_by, expires_at, created_at)
VALUES
  ('00000000000000000000000000000001', '00000000-0000-0000-0000-000000000001', 'admin',
   '00000000-0000-0000-0000-000000000000', '2099-12-31T00:00:00Z',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- ── Cloud accounts ──────────────────────────────────────────────────────────

INSERT OR IGNORE INTO cloud_accounts
  (id, organization_id, name, provider_id, fields)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Google Cloud Dev', 'gcp', '{"project":"acme-dev"}');

-- ── Connections ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO connections
  (id, organization_id, name, kind, location_type, cloud_account_id, url)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Customer Data', 'data', 'cloud', 'dddddddd-0000-0000-0000-000000000001',
   'gs://acme-dev/customers/');

INSERT OR IGNORE INTO connections
  (id, organization_id, name, kind, location_type, url)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Product Feed', 'data', 'local', 'file:///sample/products.csv');

-- ── Jobs ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO jobs
  (id, organization_id, name, status, created_at)
VALUES
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Monthly Report', 'draft',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO jobs
  (id, organization_id, name, status, created_at, started_at, error)
VALUES
  ('ffffffff-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Failed Import', 'failed',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'Connection timeout: unable to reach gs://acme-dev/customers/');
