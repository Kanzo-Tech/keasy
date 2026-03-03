-- Unified dev seed: two orgs (promotor + participant) with pre-linked users and demo data.
-- Users match Keycloak realm-import IDs — login works without invite flow.
-- Idempotent via upsert (ON CONFLICT) with fixed IDs.

-- ── Organizations ─────────────────────────────────────────────────────────────

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

INSERT INTO organizations
  (id, name, slug, legal_name, registration_number, country, role, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000002', 'ACME Corp', 'acme', 'ACME Corporation', NULL, 'DE', 'participant',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT(id) DO UPDATE SET
  role = excluded.role,
  name = excluded.name,
  legal_name = excluded.legal_name,
  updated_at = excluded.updated_at;

-- ── Members (linked to Keycloak user IDs) ─────────────────────────────────────

INSERT OR IGNORE INTO org_members
  (user_id, org_id, role, email, first_name, last_name, joined_at)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin',
   'promotor@keasy.dev', 'Admin', 'Promotor', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO org_members
  (user_id, org_id, role, email, first_name, last_name, joined_at)
VALUES
  ('bbbb0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'admin',
   'participant@keasy.dev', 'User', 'Participant', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- ── Invite tokens (optional — for testing invite flow) ────────────────────────

INSERT OR IGNORE INTO invite_tokens
  (token, org_id, role, created_by, expires_at, created_at)
VALUES
  ('00000000000000000000000000000001', '00000000-0000-0000-0000-000000000001', 'admin',
   'aaaa0000-0000-0000-0000-000000000001', '2099-12-31T00:00:00Z',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO invite_tokens
  (token, org_id, role, created_by, expires_at, created_at)
VALUES
  ('00000000000000000000000000000002', '00000000-0000-0000-0000-000000000002', 'admin',
   'bbbb0000-0000-0000-0000-000000000001', '2099-12-31T00:00:00Z',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- ══════════════════════════════════════════════════════════════════════════════
-- Demo data: Promotor (Keasy)
-- ══════════════════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════════════════
-- Demo data: Participant (ACME Corp)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Cloud accounts ──────────────────────────────────────────────────────────

INSERT OR IGNORE INTO cloud_accounts
  (id, organization_id, name, provider_id, fields)
VALUES
  ('dddddddd-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'Google Cloud Dev', 'gcp', '{"project":"acme-dev"}');

-- ── Connections ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO connections
  (id, organization_id, name, kind, location_type, cloud_account_id, url)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002',
   'Customer Data', 'data', 'cloud', 'dddddddd-0000-0000-0000-000000000002',
   'gs://acme-dev/customers/');

INSERT OR IGNORE INTO connections
  (id, organization_id, name, kind, location_type, url)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002',
   'Product Feed', 'data', 'local', 'file:///sample/products.csv');

-- ── Jobs ────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO jobs
  (id, organization_id, name, status, created_at)
VALUES
  ('ffffffff-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   'Monthly Report', 'draft',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

INSERT OR IGNORE INTO jobs
  (id, organization_id, name, status, created_at, started_at, error)
VALUES
  ('ffffffff-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002',
   'Failed Import', 'failed',
   strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
   'Connection timeout: unable to reach gs://acme-dev/customers/');
