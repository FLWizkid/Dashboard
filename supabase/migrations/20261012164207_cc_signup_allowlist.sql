/*
# Private console: only approved emails can create an account

The sign-in page lets anyone create an account. Each account only ever sees its own data, but this console belongs to one person, so new accounts are now limited to an approved list.

1. New tables
- `cc_signup_allowlist`
  - `email` (text, primary key, stored lower-case)
  - `created_at` (timestamptz)
  - Seeded with doug@theonefor.ai and doug@encountive.com.

2. New trigger
- `cc_enforce_signup_allowlist` runs before a new sign-in account is created and refuses any email not on the list.

3. Security
- RLS is enabled on `cc_signup_allowlist` with no policies, so the browser cannot read or change it. Only the database itself uses it.
- The trigger function is not callable by app users.

4. Notes
1. Existing accounts are untouched; sign-in, password and Windows Hello keep working.
2. To allow another address later, add a row to cc_signup_allowlist.
*/

CREATE TABLE IF NOT EXISTS cc_signup_allowlist (
  email text PRIMARY KEY CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cc_signup_allowlist ENABLE ROW LEVEL SECURITY;

INSERT INTO cc_signup_allowlist (email) VALUES ('doug@theonefor.ai'), ('doug@encountive.com')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cc_enforce_signup_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.email IS NULL OR NOT EXISTS (SELECT 1 FROM public.cc_signup_allowlist WHERE email = lower(NEW.email)) THEN
    RAISE EXCEPTION 'signup_not_allowed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cc_enforce_signup_allowlist() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cc_enforce_signup_allowlist ON auth.users;
CREATE TRIGGER cc_enforce_signup_allowlist
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.cc_enforce_signup_allowlist();