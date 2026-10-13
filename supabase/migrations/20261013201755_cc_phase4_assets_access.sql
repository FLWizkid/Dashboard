/*
# Phase 4: Assets & Access (also powers Renewals & Spend)

Plain English: lets Doug keep a register of every paid or free software tool (SaaS) and
every piece of hardware, record who has access to which tool and when that access was last
reviewed, and run onboarding / offboarding checklists for people.

1. New Tables
- `cc_saas_tools` - one row per software subscription.
  - name, url, category, login_account (which email signs in), company_id, identity
  - cost_amount (>= 0), billing_cycle (monthly | annual | none), renewal_date, auto_renews
  - status (active | trial | cancelled), last_used_on (drives "unused tool" flags), notes
- `cc_hardware` - laptops, phones, keys, network gear.
  - name, kind, serial, assigned_to, company_id, purchased_on, warranty_until,
    status (in_use | spare | retired), notes
- `cc_access_grants` - who can sign in to which tool.
  - person, tool_id (-> cc_saas_tools, cascade), level, granted_on, last_reviewed_on, notes
- `cc_checklists` - onboarding / offboarding runs.
  - kind (onboarding | offboarding), person, company_id, items (jsonb list of {label, done}),
    started_on, completed_at

2. Security
- RLS enabled on all four tables.
- Four separate owner-only policies (select/insert/update/delete) per table, TO authenticated,
  using auth.uid() = user_id. user_id defaults to auth.uid().

3. Notes
1. updated_at maintained by the existing cc_touch_updated_at trigger.
2. company_id is set to null if a company is deleted, so records are never lost.
*/

CREATE TABLE IF NOT EXISTS cc_saas_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  url text CHECK (url IS NULL OR char_length(url) <= 500),
  category text CHECK (category IS NULL OR char_length(category) <= 60),
  login_account text CHECK (login_account IS NULL OR char_length(login_account) <= 200),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  identity text CHECK (identity IS NULL OR identity IN ('encountive','doug_it','personal')),
  cost_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0 AND cost_amount < 10000000),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual','none')),
  renewal_date date,
  auto_renews boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','trial','cancelled')),
  last_used_on date,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_saas_tools_user_idx ON cc_saas_tools(user_id, renewal_date);

CREATE TABLE IF NOT EXISTS cc_hardware (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind text CHECK (kind IS NULL OR char_length(kind) <= 60),
  serial text CHECK (serial IS NULL OR char_length(serial) <= 120),
  assigned_to text CHECK (assigned_to IS NULL OR char_length(assigned_to) <= 120),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  purchased_on date,
  warranty_until date,
  status text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','spare','retired')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_hardware_user_idx ON cc_hardware(user_id);

CREATE TABLE IF NOT EXISTS cc_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  person text NOT NULL CHECK (char_length(person) BETWEEN 1 AND 120),
  tool_id uuid NOT NULL REFERENCES cc_saas_tools(id) ON DELETE CASCADE,
  level text CHECK (level IS NULL OR char_length(level) <= 60),
  granted_on date,
  last_reviewed_on date,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_access_grants_user_idx ON cc_access_grants(user_id);
CREATE INDEX IF NOT EXISTS cc_access_grants_tool_idx ON cc_access_grants(tool_id);

CREATE TABLE IF NOT EXISTS cc_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('onboarding','offboarding')),
  person text NOT NULL CHECK (char_length(person) BETWEEN 1 AND 120),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 60),
  started_on date NOT NULL DEFAULT current_date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_checklists_user_idx ON cc_checklists(user_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cc_saas_tools','cc_hardware','cc_access_grants','cc_checklists'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "select_own" ON %I', t);
    EXECUTE format('CREATE POLICY "select_own" ON %I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "insert_own" ON %I', t);
    EXECUTE format('CREATE POLICY "insert_own" ON %I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "update_own" ON %I', t);
    EXECUTE format('CREATE POLICY "update_own" ON %I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete_own" ON %I', t);
    EXECUTE format('CREATE POLICY "delete_own" ON %I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;