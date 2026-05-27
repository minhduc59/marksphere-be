CREATE TYPE "app"."PostReviewAction" AS ENUM ('approve', 'reject');

CREATE TABLE "app"."post_review_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "content_post_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "action" "app"."PostReviewAction" NOT NULL,
  "feedback" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_review_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "post_review_events_content_post_id_idx" ON "app"."post_review_events"("content_post_id");
CREATE INDEX "post_review_events_user_id_idx" ON "app"."post_review_events"("user_id");

ALTER TABLE "app"."post_review_events" ADD CONSTRAINT "post_review_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
