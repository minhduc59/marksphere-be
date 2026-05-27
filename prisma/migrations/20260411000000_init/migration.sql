-- Initial NestJS backend migration.
--
-- Only creates objects in the `app` schema. The `ai` schema is owned by
-- Alembic (ai-service) and MUST NOT be touched here. Do not regenerate
-- this file with `prisma migrate diff` against schema.prisma — Prisma's
-- column types won't exactly match Alembic's, so the diff would emit
-- destructive ALTER statements for ai.* tables.

-- CreateEnum
CREATE TYPE "app"."UserRole" AS ENUM ('admin', 'user');

-- CreateTable: app.users
CREATE TABLE "app"."users" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "email"         TEXT         NOT NULL,
    "password_hash" TEXT,
    "display_name"  TEXT,
    "avatar_url"    TEXT,
    "role"          "app"."UserRole" NOT NULL DEFAULT 'user',
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "app"."users"("email");

-- CreateTable: app.auth_identities
CREATE TABLE "app"."auth_identities" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"          UUID         NOT NULL,
    "provider"         TEXT         NOT NULL,
    "provider_user_id" TEXT         NOT NULL,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_identities_provider_provider_user_id_key"
    ON "app"."auth_identities"("provider", "provider_user_id");
CREATE INDEX "auth_identities_user_id_idx"
    ON "app"."auth_identities"("user_id");

ALTER TABLE "app"."auth_identities"
    ADD CONSTRAINT "auth_identities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: app.refresh_tokens
CREATE TABLE "app"."refresh_tokens" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID         NOT NULL,
    "token_hash" TEXT         NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key"
    ON "app"."refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_user_id_idx"
    ON "app"."refresh_tokens"("user_id");

ALTER TABLE "app"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: app.audit_logs
CREATE TABLE "app"."audit_logs" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID,
    "action"      TEXT         NOT NULL,
    "resource"    TEXT         NOT NULL,
    "resource_id" TEXT,
    "metadata"    JSONB,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_user_id_idx"
    ON "app"."audit_logs"("user_id");
CREATE INDEX "audit_logs_resource_resource_id_idx"
    ON "app"."audit_logs"("resource", "resource_id");

ALTER TABLE "app"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
