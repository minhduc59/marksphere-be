import { TikTokPublishInput } from '../tiktok-publisher.types';

const TITLE_MAX_CHARS = 90;
const PHOTO_DESCRIPTION_MAX_CHARS = 4000;
const CAPTION_MAX_CHARS = 2200;

export interface ZernioPostRequest {
  content: string;
  mediaItems: Array<{ type: 'video' | 'image'; url: string }>;
  platforms: Array<{ platform: 'tiktok'; accountId: string }>;
  tiktokSettings: Record<string, unknown>;
  scheduledFor?: string;
  publishNow?: boolean;
}

export interface ZernioMapperContext {
  zernioTiktokAccountId: string;
  privacyLevel: string;
}

export function buildZernioPostRequest(
  input: TikTokPublishInput,
  ctx: ZernioMapperContext,
): ZernioPostRequest {
  if (!input.videoUrl && !input.imageUrl) {
    throw new Error('Either videoUrl or imageUrl must be provided');
  }
  if (input.videoUrl && input.imageUrl) {
    throw new Error('Provide videoUrl or imageUrl, not both');
  }

  const isVideo = !!input.videoUrl;
  const captionWithTags = applyTikTokLineBreaks(
    assembleCaption(input.caption, input.tags),
  );

  const tiktokSettings: Record<string, unknown> = {
    privacy_level: ctx.privacyLevel,
    allow_comment: true,
    allow_duet: isVideo,
    allow_stitch: isVideo,
    content_preview_confirmed: true,
    express_consent_given: true,
  };

  if (isVideo && input.thumbnailUrl) {
    tiktokSettings.video_cover_image_url = input.thumbnailUrl;
  }

  if (!isVideo) {
    tiktokSettings.media_type = 'photo';
    tiktokSettings.description = captionWithTags.slice(0, PHOTO_DESCRIPTION_MAX_CHARS);
  }

  const body: ZernioPostRequest = {
    content: isVideo
      ? captionWithTags.slice(0, CAPTION_MAX_CHARS)
      : (input.title ?? captionWithTags).slice(0, TITLE_MAX_CHARS),
    mediaItems: [
      {
        type: isVideo ? 'video' : 'image',
        url: (isVideo ? input.videoUrl : input.imageUrl)!,
      },
    ],
    platforms: [{ platform: 'tiktok', accountId: ctx.zernioTiktokAccountId }],
    tiktokSettings,
  };

  if (input.scheduledAt) {
    body.scheduledFor = input.scheduledAt;
  } else {
    body.publishNow = true;
  }

  return body;
}

function assembleCaption(caption: string, tags?: string[]): string {
  if (!tags?.length) return caption;
  const formatted = tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  return `${caption}\n\n${formatted}`;
}

// TikTok collapses blank lines. Replacing each empty line with the invisible
// Braille Pattern Blank (U+2800) gives TikTok a non-empty line to preserve.
const TIKTOK_LINEBREAK_FILLER = '⠀';

function applyTikTokLineBreaks(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? TIKTOK_LINEBREAK_FILLER : line))
    .join('\n');
}
