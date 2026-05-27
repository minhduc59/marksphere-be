-- Migration: add Ayrshare profile fields and TikTok linked flag to users
ALTER TABLE "app"."users"
  ADD COLUMN IF NOT EXISTS "ayrshare_profile_key" TEXT,
  ADD COLUMN IF NOT EXISTS "ayrshare_ref_id"      TEXT,
  ADD COLUMN IF NOT EXISTS "tiktok_linked"         BOOLEAN NOT NULL DEFAULT false;
