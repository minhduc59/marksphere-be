-- Migration: replace Ayrshare profile fields with Zernio fields on app.users.
-- Ayrshare integration has been removed; TikTok publishing is now handled via Zernio.
-- The tiktok_linked flag is preserved (still semantically meaningful).

ALTER TABLE "app"."users"
  DROP COLUMN IF EXISTS "ayrshare_profile_key",
  DROP COLUMN IF EXISTS "ayrshare_ref_id";

ALTER TABLE "app"."users"
  ADD COLUMN IF NOT EXISTS "zernio_profile_id"          TEXT,
  ADD COLUMN IF NOT EXISTS "zernio_tiktok_account_id"   TEXT;
