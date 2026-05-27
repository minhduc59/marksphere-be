-- Idempotency log for Zernio webhook events.
-- The webhook handler INSERTs a row keyed by the upstream event UUID; a
-- unique-violation (PRIMARY KEY conflict) means the event was already
-- processed, so the handler can short-circuit to a 2xx response.

CREATE TABLE IF NOT EXISTS "app"."zernio_webhook_events" (
  "event_id"    TEXT        NOT NULL,
  "event_name"  TEXT        NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "zernio_webhook_events_pkey" PRIMARY KEY ("event_id")
);
