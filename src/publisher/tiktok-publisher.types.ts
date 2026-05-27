/**
 * Provider-agnostic TikTok publishing types.
 *
 * The adapter accepts either video or image media (polymorphic). Exactly one
 * of `videoUrl` or `imageUrl` must be provided; passing both or neither is a
 * validation error in the adapter.
 */

export interface TikTokPublishInput {
  publishedPostId: string;
  userId: string;
  caption: string;
  title?: string;
  tags?: string[];
  scheduledAt?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
}

export type TikTokPublishStatus = 'scheduled' | 'processing' | 'published' | 'failed';

export interface TikTokPublishResult {
  postId: string;
  status: TikTokPublishStatus;
  publishedUrl: string | null;
}

export interface SocialLinkEvent {
  type: 'connected' | 'disconnected';
  platform: 'tiktok';
  accountId: string;
  refId: string;
}

export interface PublishStatusEvent {
  status: TikTokPublishStatus;
  providerPostId: string;
  publishedUrl: string | null;
  errorMessage?: string;
}
