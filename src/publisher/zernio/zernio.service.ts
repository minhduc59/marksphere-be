import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { StatusGateway } from '../../status/status.gateway';
import { TikTokPublisher } from '../tiktok-publisher.interface';
import {
  TikTokPublishInput,
  TikTokPublishResult,
  TikTokPublishStatus,
} from '../tiktok-publisher.types';
import { buildZernioPostRequest } from './zernio.mapper';
import {
  ZernioWebhookEnvelope,
  ZernioPostPayload,
  ZernioAccountPayload,
} from './dto/zernio-webhook.dto';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const DEFAULT_PRIVACY_LEVEL = 'PUBLIC_TO_EVERYONE';

const POLL_INTERVAL_MS = 30_000;

@Injectable()
export class ZernioService implements TikTokPublisher, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZernioService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly gateway: StatusGateway,
  ) {
    this.baseUrl = config.get<string>('ZERNIO_BASE_URL', 'https://zernio.com/api/v1');
    this.apiKey = config.getOrThrow<string>('ZERNIO_API_KEY');
    this.webhookSecret = config.getOrThrow<string>('ZERNIO_WEBHOOK_SECRET');
  }

  onModuleInit() {
    // Background poll: never let a transient DB/API error escape as an
    // unhandled rejection — that would crash the whole process.
    this.pollTimer = setInterval(() => {
      this.syncProcessingPosts().catch((err) =>
        this.logger.error(
          `zernio: syncProcessingPosts failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async syncProcessingPosts(): Promise<void> {
    const posts = await this.prisma.publishedPost.findMany({
      where: { status: 'processing', tiktokPublishId: { not: null } },
      select: { id: true, tiktokPublishId: true, contentPostId: true },
    });
    if (posts.length === 0) return;
    this.logger.debug(`zernio: polling ${posts.length} processing post(s)`);
    await Promise.all(
      posts.map((p) =>
        this.pollOnePost(p.id, p.tiktokPublishId!, p.contentPostId),
      ),
    );
  }

  /**
   * Mirror a successful publish onto the owning content post. The Zernio flow
   * only tracks PublishStatus on `published_posts`; without this the content
   * post stays at `approved`, so `GET /posts?status=published` (which filters
   * `ai.content_posts.status`) returns nothing. `backend_svc` holds UPDATE
   * grant on `ai.content_posts` for exactly this read-path mirror.
   */
  private async markContentPostPublished(contentPostId: string): Promise<void> {
    try {
      await this.prisma.contentPost.update({
        where: { id: contentPostId },
        data: { status: 'published', updatedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `zernio: failed to mirror published status onto content_post ${contentPostId}: ${(err as Error).message}`,
      );
    }
  }

  private async pollOnePost(
    publishedPostId: string,
    zernioPostId: string,
    contentPostId: string,
  ): Promise<void> {
    try {
      const data = await this.apiGet<{ post: ZernioPostPayload }>(
        `/posts/${encodeURIComponent(zernioPostId)}`,
      );
      const post = data.post;
      const normalized = this.normalizeStatus(post.status);
      if (normalized === 'processing') return;

      const platformPostId =
        post.platforms?.[0]?.platformPostUrl ?? post.platformPostUrl ?? null;

      if (normalized === 'published') {
        await this.prisma.publishedPost.update({
          where: { id: publishedPostId },
          data: { status: 'published', publishedAt: new Date(), platformPostId },
        });
        await this.markContentPostPublished(contentPostId);
        this.gateway.notifyRoom(`publish:${publishedPostId}`, 'publish.status_changed', {
          publishedPostId,
          status: 'published',
          postUrl: platformPostId,
        });
        this.logger.log(`zernio: poll → published postId=${zernioPostId}`);
      } else if (normalized === 'failed') {
        const errorMessage =
          post.errorMessage ?? post.platforms?.[0]?.error ?? 'Post failed on TikTok';
        await this.prisma.publishedPost.update({
          where: { id: publishedPostId },
          data: { status: 'failed', errorMessage },
        });
        this.gateway.notifyRoom(`publish:${publishedPostId}`, 'publish.status_changed', {
          publishedPostId,
          status: 'failed',
        });
        this.logger.warn(`zernio: poll → failed postId=${zernioPostId} reason=${errorMessage}`);
      }
    } catch (err) {
      this.logger.warn(
        `zernio: poll error for postId=${zernioPostId}: ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    try {
      const { data } = await firstValueFrom(
        this.http.post<T>(url, body, { headers: this.headers() }),
      );
      return data;
    } catch (err) {
      this.logHttpError('POST', path, err);
      throw err;
    }
  }

  private async apiGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    try {
      const { data } = await firstValueFrom(
        this.http.get<T>(url, { headers: this.headers() }),
      );
      return data;
    } catch (err) {
      this.logHttpError('GET', path, err);
      throw err;
    }
  }

  private async apiDelete<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    try {
      const { data } = await firstValueFrom(
        this.http.delete<T>(url, { headers: this.headers() }),
      );
      return data;
    } catch (err) {
      this.logHttpError('DELETE', path, err);
      throw err;
    }
  }

  private logHttpError(method: string, path: string, err: unknown): void {
    const axErr = err as AxiosError<{ error?: string; details?: unknown }>;
    const status = axErr.response?.status;
    const msg = axErr.response?.data?.error ?? axErr.message;
    this.logger.error(`zernio ${method} ${path} → ${status}: ${msg}`);
  }

  // -------------------------------------------------------------------------
  // Profile management — one Zernio profile per app user
  // -------------------------------------------------------------------------

  async ensureProfile(
    userId: string,
    email: string,
    displayName?: string | null,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`User ${userId} not found`);
    if (user.zernioProfileId) {
      this.logger.debug(`zernio: profile already exists for user ${userId}`);
      return user.zernioProfileId;
    }

    this.logger.log(`zernio: creating profile for user ${userId}`);

    const name = `${displayName || email} (${userId.slice(0, 8)})`;

    let profileId: string;
    try {
      const data = await this.apiPost<{ profile: { _id: string; name: string } }>(
        '/profiles',
        { name },
      );
      profileId = data.profile._id;
    } catch (err) {
      const axErr = err as AxiosError<{ error?: string }>;
      if (axErr.response?.status === 403) {
        // Free plan profile limit — the profile may have been created in a previous
        // attempt but the ID was never saved. Try to recover it from the list.
        this.logger.warn(
          `zernio: profile limit hit for user ${userId} — attempting recovery from profile list`,
        );
        profileId = await this.recoverProfileId(userId, name);
      } else {
        throw err;
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { zernioProfileId: profileId },
    });

    this.logger.log(`zernio: profile ready for user ${userId} → ${profileId}`);
    return profileId;
  }

  private async recoverProfileId(userId: string, expectedName: string): Promise<string> {
    const data = await this.apiGet<{ profiles: Array<{ _id: string; name: string }> }>(
      '/profiles',
    );
    const match = data.profiles.find((p) => p.name === expectedName);
    if (!match) {
      throw new BadRequestException(
        'Zernio profile limit reached and no matching profile found. ' +
          'Please contact support or delete an unused profile in your Zernio dashboard.',
      );
    }
    this.logger.log(`zernio: recovered profile ${match._id} for user ${userId}`);
    return match._id;
  }

  async generateConnectUrl(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const callbackBase = this.config.get<string>(
      'TIKTOK_CALLBACK_BASE_URL',
      'http://localhost:3000',
    );
    const connectPath = (profileId: string): string => {
      const redirectUrl = `${callbackBase}/v1/publisher/tiktok/callback?profileId=${encodeURIComponent(profileId)}`;
      return `/connect/tiktok?profileId=${encodeURIComponent(profileId)}&redirectUrl=${encodeURIComponent(redirectUrl)}`;
    };

    const storedProfileId = user.zernioProfileId;
    const profileId =
      storedProfileId ??
      (await this.ensureProfile(userId, user.email, user.displayName));

    try {
      const data = await this.apiGet<{ authUrl: string }>(connectPath(profileId));
      return data.authUrl;
    } catch (err) {
      const axErr = err as AxiosError;
      // A 404 against the *stored* profile id means it's stale — the Zernio
      // profile was deleted or the API key no longer has access to it (e.g. key
      // rotated). Drop the dead id + its linked account and recreate, then retry
      // once. A 404 on a freshly created profile, or any other error, rethrows.
      if (axErr.response?.status !== 404 || !storedProfileId) throw err;

      this.logger.warn(
        `zernio: stale profile ${storedProfileId} for user ${userId} — recreating`,
      );
      await this.prisma.user.update({
        where: { id: userId },
        data: { zernioProfileId: null, zernioTiktokAccountId: null, tiktokLinked: false },
      });
      this.gateway.notifyRoom(`user:${userId}`, 'tiktok.link_changed', {
        linked: false,
        platform: 'tiktok',
      });

      const freshProfileId = await this.ensureProfile(userId, user.email, user.displayName);
      const data = await this.apiGet<{ authUrl: string }>(connectPath(freshProfileId));
      return data.authUrl;
    }
  }

  async handleTikTokCallback(profileId: string): Promise<string> {
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN', 'http://localhost:3001');
    const errorUrl = `${frontendOrigin}/settings/accounts?tiktok=error`;

    if (!profileId) return errorUrl;

    const user = await this.prisma.user.findFirst({
      where: { zernioProfileId: profileId },
    });
    if (!user) {
      this.logger.warn(`tiktok callback: no user for profileId=${profileId}`);
      return errorUrl;
    }

    let accounts: Array<{ _id: string; platform: string; isActive: boolean }>;
    try {
      const data = await this.apiGet<{
        accounts: Array<{ _id: string; platform: string; isActive: boolean }>;
      }>(`/accounts?profileId=${encodeURIComponent(profileId)}`);
      accounts = data.accounts;
    } catch (err) {
      this.logger.error(
        `tiktok callback: failed to fetch accounts for profileId=${profileId}: ${(err as Error).message}`,
      );
      return errorUrl;
    }

    const tiktokAccount = accounts.find(
      (a) => a.platform === 'tiktok' && a.isActive,
    );
    if (!tiktokAccount) {
      this.logger.warn(
        `tiktok callback: no active TikTok account for profileId=${profileId}`,
      );
      return errorUrl;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { tiktokLinked: true, zernioTiktokAccountId: tiktokAccount._id },
    });

    this.logger.log(
      `tiktok callback: linked account ${tiktokAccount._id} to user ${user.id}`,
    );
    this.gateway.notifyRoom(`user:${user.id}`, 'tiktok.link_changed', {
      linked: true,
      platform: 'tiktok',
    });

    return `${frontendOrigin}/settings/accounts?tiktok=connected`;
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  async publishPost(input: TikTokPublishInput): Promise<TikTokPublishResult> {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user?.zernioProfileId) {
      throw new BadRequestException(
        'No Zernio profile. Profile must be created on registration.',
      );
    }
    if (!user.tiktokLinked || !user.zernioTiktokAccountId) {
      throw new BadRequestException(
        'TikTok account not linked. Complete the TikTok linking flow first.',
      );
    }

    if (!input.videoUrl && !input.imageUrl) {
      throw new BadRequestException('Either videoUrl or imageUrl must be provided');
    }
    if (input.videoUrl && input.imageUrl) {
      throw new BadRequestException('Provide videoUrl or imageUrl, not both');
    }

    const existing = await this.prisma.publishedPost.findUnique({
      where: { id: input.publishedPostId },
    });
    if (existing?.tiktokPublishId) {
      this.logger.warn(
        `zernio: publishedPost ${input.publishedPostId} already has provider id ${existing.tiktokPublishId} — skipping`,
      );
      return {
        postId: existing.tiktokPublishId,
        status: this.mapStatus(existing.status),
        publishedUrl: existing.platformPostId,
      };
    }

    const body = buildZernioPostRequest(input, {
      zernioTiktokAccountId: user.zernioTiktokAccountId,
      privacyLevel: existing?.privacyLevel ?? DEFAULT_PRIVACY_LEVEL,
    });

    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        this.logger.log(
          `zernio: publish attempt ${attempt + 1} for publishedPostId=${input.publishedPostId}`,
        );
        const data = await this.apiPost<{ post: ZernioPostPayload; message?: string }>(
          '/posts',
          body,
        );
        const post = data.post;
        this.logger.log(`zernio: post accepted id=${post._id} status=${post.status}`);

        // Persist the provider id immediately so any later retry short-circuits at
        // the idempotency guard above — even if the response to ai-service is lost.
        // If Zernio already published synchronously (publishNow), also flip status
        // and notify the client now instead of waiting for the webhook.
        await this.prisma.publishedPost.update({
          where: { id: input.publishedPostId },
          data: {
            tiktokPublishId: post._id,
            ...(post.status === 'published'
              ? {
                  status: 'published',
                  publishedAt: new Date(),
                  platformPostId: post.platformPostUrl ?? null,
                }
              : {}),
          },
        });

        if (post.status === 'published') {
          if (existing?.contentPostId) {
            await this.markContentPostPublished(existing.contentPostId);
          }
          this.gateway.notifyRoom(
            `publish:${input.publishedPostId}`,
            'publish.status_changed',
            { id: input.publishedPostId, status: 'published', postUrl: post.platformPostUrl ?? null },
          );
        }

        return {
          postId: post._id,
          status: this.normalizeStatus(post.status),
          publishedUrl: post.platformPostUrl ?? null,
        };
      } catch (err) {
        lastError = err;
        const axErr = err as AxiosError;
        const status = axErr.response?.status;
        if (status === 401 || status === 403) {
          throw new UnauthorizedException(`Zernio auth failed (${status})`);
        }
        if (status && status >= 400 && status < 500) break;
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
      }
    }

    // Convert the raw AxiosError to a proper HttpException so the global filter
    // preserves the downstream status (otherwise it collapses to a generic 500
    // and ai-service keeps retrying a non-retryable conflict).
    const axErr = lastError as AxiosError;
    const status = axErr.response?.status;
    if (status === 409) {
      throw new ConflictException(
        'Zernio: bài đăng đã tồn tại (có thể đã được gửi trước đó) — kiểm tra trên Zernio/TikTok.',
      );
    }
    if (status && status >= 400 && status < 500) {
      throw new HttpException((axErr.response?.data as object) ?? axErr.message, status);
    }
    throw new ServiceUnavailableException('Zernio publish failed after retries');
  }

  async cancelScheduled(publishedPostId: string): Promise<void> {
    const record = await this.prisma.publishedPost.findUnique({
      where: { id: publishedPostId },
    });
    if (!record?.tiktokPublishId) {
      throw new BadRequestException('No Zernio post id found on this record');
    }
    await this.apiDelete(`/posts/${encodeURIComponent(record.tiktokPublishId)}`);
  }

  /**
   * Cancel a scheduled Zernio post and reset the DB record so the normal
   * publish pipeline can re-submit it immediately. The caller is responsible
   * for re-triggering publish via ai-service (which has access to media URLs).
   */
  async publishNow(userId: string, publishedPostId: string): Promise<void> {
    const record = await this.prisma.publishedPost.findUnique({
      where: { id: publishedPostId },
    });
    if (!record) throw new BadRequestException('Published post not found');
    if (record.publishedBy !== userId) throw new UnauthorizedException('Not your post');
    if (!['pending', 'processing'].includes(record.status)) {
      throw new BadRequestException(
        `Cannot trigger publish: post is in '${record.status}' state`,
      );
    }

    if (record.tiktokPublishId) {
      try {
        await this.apiDelete(`/posts/${encodeURIComponent(record.tiktokPublishId)}`);
      } catch (err) {
        this.logger.warn(
          `zernio: cancel-scheduled before publishNow failed (continuing): ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.publishedPost.update({
      where: { id: publishedPostId },
      data: {
        tiktokPublishId: null,
        status: 'pending',
        scheduledAt: null,
      },
    });

    this.logger.log(
      `zernio: publishNow → cleared schedule for ${publishedPostId}; caller should re-trigger publish`,
    );
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  validateWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!signature) return false;
    const digest = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    if (digest.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  validateInternalApiKey(key: string): boolean {
    const expected = this.config.get<string>('AI_SERVICE_INTERNAL_API_KEY', '');
    return expected.length > 0 && key === expected;
  }

  async broadcastPublishStatusChange(input: {
    publishedPostId: string;
    status: 'pending' | 'processing' | 'published' | 'failed' | 'cancelled';
    errorMessage?: string;
    stage?: string;
  }): Promise<void> {
    if (input.errorMessage) {
      this.logger.warn(
        `publish status broadcast: id=${input.publishedPostId} status=${input.status} ` +
          `stage=${input.stage ?? '-'} error=${input.errorMessage.slice(0, 200)}`,
      );
    }
    this.gateway.notifyRoom(
      `publish:${input.publishedPostId}`,
      'publish.status_changed',
      {
        publishedPostId: input.publishedPostId,
        status: input.status,
      },
    );
  }

  async handleWebhook(envelope: Record<string, unknown>): Promise<void> {
    const event = envelope as unknown as ZernioWebhookEnvelope;
    this.logger.log(`zernio webhook: event=${event.event} id=${event.id}`);

    // Idempotency: Zernio retries up to 7× on exponential backoff. Insert
    // event.id; on PK conflict, this delivery is a retry of an event we
    // already processed — short-circuit so we don't double-update posts or
    // double-emit websocket notifications. Events without an id (e.g. test
    // pings) fall through unchecked.
    if (event.id) {
      try {
        await this.prisma.zernioWebhookEvent.create({
          data: { eventId: event.id, eventName: String(event.event) },
        });
      } catch (err) {
        if (this.isUniqueViolation(err)) {
          this.logger.log(
            `zernio webhook: event ${event.id} already processed — skipping`,
          );
          return;
        }
        throw err;
      }
    }

    switch (event.event) {
      case 'account.connected':
      case 'account.disconnected':
        if (event.account) {
          await this.handleAccountEvent(event.event, event.account);
        }
        break;
      case 'post.scheduled':
      case 'post.published':
      case 'post.failed':
      case 'post.cancelled':
      case 'post.partial':
        if (event.post) {
          await this.handlePostEvent(event.event, event.post);
        }
        break;
      case 'webhook.test':
        this.logger.log('zernio webhook: test ping received');
        break;
      default:
        this.logger.debug(`zernio webhook: ignoring event ${event.event}`);
    }
  }

  private async handleAccountEvent(
    eventName: 'account.connected' | 'account.disconnected',
    account: ZernioAccountPayload,
  ): Promise<void> {
    if (account.platform !== 'tiktok') return;
    if (!account.profileId) {
      this.logger.warn(`zernio account event missing profileId for account ${account._id}`);
      return;
    }

    const user = await this.prisma.user.findFirst({
      where: { zernioProfileId: account.profileId },
    });
    if (!user) {
      this.logger.warn(
        `zernio account event: no user found for profileId=${account.profileId}`,
      );
      return;
    }

    const linked = eventName === 'account.connected';
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        tiktokLinked: linked,
        zernioTiktokAccountId: linked ? account._id : null,
      },
    });

    this.logger.log(
      `zernio: tiktok ${linked ? 'linked' : 'unlinked'} for user ${user.id}`,
    );

    this.gateway.notifyRoom(`user:${user.id}`, 'tiktok.link_changed', {
      linked,
      platform: 'tiktok',
    });
  }

  private async handlePostEvent(
    eventName: string,
    post: ZernioPostPayload,
  ): Promise<void> {
    const record = await this.prisma.publishedPost.findFirst({
      where: { tiktokPublishId: post._id },
    });
    if (!record) {
      this.logger.warn(`zernio post event: no published_post for postId=${post._id}`);
      return;
    }

    const tiktokPlatform = post.platforms?.find((p) => p.platform === 'tiktok');
    const postUrl =
      tiktokPlatform?.platformPostUrl ?? post.platformPostUrl ?? null;
    const errorMsg = tiktokPlatform?.error ?? post.errorMessage ?? null;

    let dbStatus: 'pending' | 'processing' | 'published' | 'failed' | 'cancelled';
    let publishedAt: Date | null = null;
    let errorMessage: string | null = null;

    switch (eventName) {
      case 'post.published':
        dbStatus = 'published';
        publishedAt = new Date();
        break;
      case 'post.scheduled':
        dbStatus = 'pending';
        break;
      case 'post.cancelled':
        dbStatus = 'cancelled';
        break;
      case 'post.failed':
      case 'post.partial':
        dbStatus = 'failed';
        errorMessage = errorMsg ?? 'unknown';
        break;
      default:
        return;
    }

    await this.prisma.publishedPost.update({
      where: { id: record.id },
      data: {
        status: dbStatus,
        platformPostId: postUrl,
        publishedAt,
        errorMessage,
      },
    });

    if (dbStatus === 'published') {
      await this.markContentPostPublished(record.contentPostId);
    }

    this.gateway.notifyRoom(`publish:${record.id}`, 'publish.status_changed', {
      publishedPostId: record.id,
      status: dbStatus,
      postUrl,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private normalizeStatus(zernioStatus: string): TikTokPublishStatus {
    switch (zernioStatus) {
      case 'published':
        return 'published';
      case 'scheduled':
        return 'scheduled';
      case 'failed':
      case 'cancelled':
        return 'failed';
      default:
        return 'processing';
    }
  }

  private mapStatus(dbStatus: string): TikTokPublishStatus {
    switch (dbStatus) {
      case 'published':
        return 'published';
      case 'failed':
      case 'cancelled':
        return 'failed';
      case 'pending':
        return 'scheduled';
      default:
        return 'processing';
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    // Prisma surfaces unique-constraint violations as P2002. Check by code
    // without importing the runtime to keep the dependency surface small.
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }
}
