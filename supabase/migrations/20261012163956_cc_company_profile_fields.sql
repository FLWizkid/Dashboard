/*
# Company profile fields

Adds three optional details to each company so the console knows what each company is and what Doug does there.

1. Modified tables
- `cc_companies`
  - `website` (text, optional) - bare domain such as kreweandkin.com
  - `my_role` (text, optional) - Doug's role at that company, e.g. "Co-founder, IT only"
  - `key_contact` (text, optional) - main person to reach, e.g. "Melissa (Missy), Co-founder & CEO"

2. Security
- No policy changes. Existing owner-only policies on cc_companies already cover the new columns.

3. Notes
1. Additive only; nothing is removed or renamed.
2. Length limits keep entries tidy (website 253, role and contact 160).
*/

ALTER TABLE cc_companies ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE cc_companies ADD COLUMN IF NOT EXISTS my_role text;
ALTER TABLE cc_companies ADD COLUMN IF NOT EXISTS key_contact text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cc_companies_profile_lengths') THEN
    ALTER TABLE cc_companies ADD CONSTRAINT cc_companies_profile_lengths CHECK (
      (website IS NULL OR char_length(website) <= 253)
      AND (my_role IS NULL OR char_length(my_role) <= 160)
      AND (key_contact IS NULL OR char_length(key_contact) <= 160)
    );
  END IF;
END $$;