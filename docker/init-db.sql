-- One-shot Postgres role bootstrap. Runs at container init.
--
-- Creates two service roles with disjoint write surface:
--   ai_svc       — owns `ai` schema, read on `app`
--   backend_svc  — owns `app` schema, read on `ai`, narrow writes on
--                  content_posts (status updates) and published_posts.
--
-- The Alembic migration `f2a3b4c5d6e7_multi_user_ai_schema.py` creates
-- the `ai` + `app` schemas themselves. This script only creates roles
-- and grants; re-running is safe (all operations are idempotent).
--
-- NOTE: Alembic runs as the `scanner` superuser. Tables it creates are
-- owned by `scanner`, not `ai_svc`. We therefore grant explicit access
-- on ALL existing objects (not just DEFAULT PRIVILEGES) so that the
-- grants work regardless of creation order.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_svc') THEN
    CREATE ROLE ai_svc LOGIN PASSWORD 'ai_svc_pass';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backend_svc') THEN
    CREATE ROLE backend_svc LOGIN PASSWORD 'backend_pass';
  END IF;
END
$$;

-- Make the schemas before Alembic runs so grants apply cleanly.
CREATE SCHEMA IF NOT EXISTS ai AUTHORIZATION ai_svc;
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION backend_svc;

-- The original `scanner` superuser stays around as the Alembic owner so
-- that migrations can ALTER TABLE ... SET SCHEMA. In prod you would
-- rotate to a dedicated migration role; for the thesis demo we keep
-- things simple.
GRANT ALL ON SCHEMA ai TO scanner;
GRANT ALL ON SCHEMA app TO scanner;

-- ai_svc: full access to ai schema (its own), read on app
GRANT ALL PRIVILEGES ON SCHEMA ai TO ai_svc;
GRANT USAGE ON SCHEMA app TO ai_svc;
GRANT ALL ON ALL TABLES IN SCHEMA ai TO ai_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ai TO ai_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO ai_svc;

-- backend_svc: full access to app schema (its own), read + narrow write on ai
GRANT ALL PRIVILEGES ON SCHEMA app TO backend_svc;
GRANT USAGE ON SCHEMA ai TO backend_svc;
GRANT ALL ON ALL TABLES IN SCHEMA app TO backend_svc;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO backend_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA ai TO backend_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ai TO backend_svc;

-- Narrow write surface: backend_svc owns user-facing create/update flows
-- for the video clipper pipeline. ai_svc still owns enrichment writes
-- (transcripts, scores, storage_url, etc.).
GRANT INSERT, UPDATE ON ai.video_tasks         TO backend_svc;
GRANT INSERT, UPDATE ON ai.video_clips         TO backend_svc;
GRANT INSERT, UPDATE ON ai.content_posts       TO backend_svc;
GRANT INSERT          ON ai.brand_fonts        TO backend_svc;
GRANT INSERT          ON ai.caption_templates  TO backend_svc;

-- Default privileges for objects Alembic creates later (as scanner)
ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA ai
  GRANT ALL ON TABLES TO ai_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA ai
  GRANT ALL ON SEQUENCES TO ai_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA ai
  GRANT SELECT ON TABLES TO backend_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA ai
  GRANT USAGE, SELECT ON SEQUENCES TO backend_svc;

ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA app
  GRANT SELECT ON TABLES TO ai_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA app
  GRANT ALL ON TABLES TO backend_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE scanner IN SCHEMA app
  GRANT ALL ON SEQUENCES TO backend_svc;

-- pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
