/**
 * Zernio webhook event payloads. Strongly typed for the events we handle;
 * the controller passes the raw envelope through to the service which discriminates.
 *
 * Source: https://docs.zernio.com/webhooks
 */

export type ZernioWebhookEventName =
  | 'account.connected'
  | 'account.disconnected'
  | 'post.scheduled'
  | 'post.published'
  | 'post.failed'
  | 'post.cancelled'
  | 'post.partial'
  | 'webhook.test'
  | string;

export interface ZernioWebhookEnvelope {
  id: string;
  event: ZernioWebhookEventName;
  timestamp: string;
  account?: ZernioAccountPayload;
  post?: ZernioPostPayload;
  [extra: string]: unknown;
}

export interface ZernioAccountPayload {
  _id: string;
  platform: string;
  profileId?: string;
  username?: string;
  displayName?: string;
  isActive?: boolean;
  refId?: string;
}

export interface ZernioPostPayload {
  _id: string;
  status: string;
  platforms?: Array<{
    platform: string;
    status?: string;
    platformPostUrl?: string;
    accountId?: string | { _id: string };
    error?: string;
  }>;
  platformPostUrl?: string;
  scheduledFor?: string;
  publishedAt?: string;
  errorMessage?: string;
}
