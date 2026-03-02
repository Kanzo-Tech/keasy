-- Dev promotor seed: bootstrap org + demo data (cloud accounts, connections, jobs).
-- Users join via invite link — no hardcoded users/memberships.
-- Idempotent via upsert (ON CONFLICT) with fixed IDs.

-- ── Bootstrap (same as promotor.sql) ────────────────────────────────────────

INSERT INTO organizations
  (id, name, slug, legal_name, registration_number, country, role, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Keasy', 'keasy', 'Keasy Promotor Org', NULL, 'EU', 'promotor',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  role = excluded.role,
  name = excluded.name,
  legal_name = excluded.legal_name,
  updated_at = excluded.updated_at;

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
   'AWS Production', 's3', '{"region":"eu-west-1"}');

-- ── Connections ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO connections
  (id, organization_id, name, kind, location_type, url)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Product Catalog', 'data', 'local', 'file:///sample/products.csv');

INSERT OR IGNORE INTO connections
  (id, organization_id, name, kind, location_type, url)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Schema.org Vocab', 'vocab', 'local', 'https://schema.org');

-- ── Jobs ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO jobs
  (id, organization_id, name, status, created_at, started_at, completed_at, pipeline)
VALUES
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Product ETL', 'completed',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   '{"inputs":[{"connection":"Product Catalog"}],"operations":[{"type":"map","field":"name"}],"outputs":[{"format":"turtle"}]}');
