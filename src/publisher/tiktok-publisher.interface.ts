import {
  TikTokPublishInput,
  TikTokPublishResult,
} from './tiktok-publisher.types';

export const TIKTOK_PUBLISHER = Symbol('TIKTOK_PUBLISHER');

/**
 * Provider-agnostic interface for publishing posts to TikTok. Implementations
 * adapt a specific upstream API (Zernio, Ayrshare, direct TikTok, etc.) to a
 * stable shape so the rest of the codebase doesn't bind to one vendor.
 */
export interface TikTokPublisher {
  ensureProfile(
    userId: string,
    email: string,
    displayName?: string | null,
  ): Promise<string>;

  generateConnectUrl(userId: string): Promise<string>;

  publishPost(input: TikTokPublishInput): Promise<TikTokPublishResult>;

  cancelScheduled(publishedPostId: string): Promise<void>;

  publishNow(userId: string, publishedPostId: string): Promise<void>;

  validateWebhookSignature(rawBody: Buffer, signature: string): boolean;

  validateInternalApiKey(key: string): boolean;

  handleWebhook(event: Record<string, unknown>): Promise<void>;
}
