-- Postgres text equality is case-sensitive, and User.email had no
-- case-insensitive index or normalization anywhere — so "Owner@x.com" at
-- signup and "owner@x.com" at login were two different strings, and
-- login failed with the generic "Invalid email or password" (identical
-- message for "no such user" and "wrong password", so it read exactly
-- like a wrong-password bug even though the lookup itself never found a
-- row). Fixed at the application boundary (SignupDto/LoginDto normalize
-- email to lowercase before either signup or login ever sees it), but
-- that only protects the one call path that goes through those DTOs.
--
-- This CHECK constraint is the same guarantee enforced at the data
-- layer, so any future code that skips the DTO layer (a script, another
-- service, a fixed-up migration) can't quietly reintroduce mixed-case
-- emails. Confirmed no existing rows violate it before adding.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_email_lowercase_check'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_email_lowercase_check" CHECK (email = lower(email));
  END IF;
END
$$;
