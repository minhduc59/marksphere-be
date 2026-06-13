import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { ZernioService } from './zernio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StatusGateway } from '../../status/status.gateway';

const mockUser = {
  id: 'user-uuid-1234',
  email: 'test@example.com',
  displayName: 'Test User',
  zernioProfileId: 'prof_abc',
  zernioTiktokAccountId: 'acc_tiktok_xyz',
  tiktokLinked: true,
};

const makePrisma = () => ({
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  publishedPost: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  zernioWebhookEvent: {
    create: jest.fn().mockResolvedValue({}),
  },
});

const makeHttp = () => ({
  post: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
});

const makeGateway = () => ({ notifyRoom: jest.fn() });

const makeConfig = () => ({
  get: jest.fn((key: string, def?: string) => {
    const vals: Record<string, string> = {
      ZERNIO_BASE_URL: 'https://zernio.com/api/v1',
      ZERNIO_API_KEY: 'sk_test_key',
      ZERNIO_WEBHOOK_SECRET: 'webhook-secret-xyz',
      AI_SERVICE_INTERNAL_API_KEY: 'internal-key-abc',
    };
    return vals[key] ?? def ?? '';
  }),
  getOrThrow: jest.fn((key: string) => {
    const vals: Record<string, string> = {
      ZERNIO_API_KEY: 'sk_test_key',
      ZERNIO_WEBHOOK_SECRET: 'webhook-secret-xyz',
    };
    if (!vals[key]) throw new Error(`Missing config: ${key}`);
    return vals[key];
  }),
});

const makeAxiosResponse = <T>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: { headers: {} as never },
});

const makeAxiosError = (status: number, body: unknown = {}): AxiosError => {
  const err = new AxiosError('http error');
  err.response = {
    status,
    statusText: '',
    data: body,
    headers: {},
    config: { headers: {} as never },
  };
  return err;
};

describe('ZernioService', () => {
  let service: ZernioService;
  let prisma: ReturnType<typeof makePrisma>;
  let http: ReturnType<typeof makeHttp>;
  let gateway: ReturnType<typeof makeGateway>;

  beforeEach(async () => {
    prisma = makePrisma();
    http = makeHttp();
    gateway = makeGateway();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZernioService,
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: PrismaService, useValue: prisma },
        { provide: StatusGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<ZernioService>(ZernioService);
  });

  describe('ensureProfile', () => {
    it('returns existing profileId when user already has one', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      const id = await service.ensureProfile(mockUser.id, mockUser.email);
      expect(id).toBe(mockUser.zernioProfileId);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('creates a Zernio profile and persists profileId for new user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, zernioProfileId: null });
      http.post.mockReturnValue(of(makeAxiosResponse({ profile: { _id: 'prof_NEW', name: 'x' } })));
      prisma.user.update.mockResolvedValue({});

      const id = await service.ensureProfile(mockUser.id, mockUser.email);
      expect(id).toBe('prof_NEW');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { zernioProfileId: 'prof_NEW' },
        }),
      );
    });
  });

  describe('generateConnectUrl', () => {
    it('returns the Zernio authUrl using the stored profileId', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.get.mockReturnValue(of(makeAxiosResponse({ authUrl: 'https://zernio.com/oauth/abc' })));

      const url = await service.generateConnectUrl(mockUser.id);

      expect(url).toBe('https://zernio.com/oauth/abc');
      expect(http.get.mock.calls[0][0]).toContain(`profileId=${mockUser.zernioProfileId}`);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('recreates the profile and retries when the stored profileId is stale (404)', async () => {
      // generateConnectUrl reads the user (stale id); ensureProfile re-reads it after
      // we null the id in the DB, so the second read has no profileId → triggers create.
      prisma.user.findUnique
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ ...mockUser, zernioProfileId: null });
      // 1st /connect/tiktok → 404 (stale), profile recreate POST → new id, 2nd /connect/tiktok → 200
      http.get
        .mockReturnValueOnce(throwError(() => makeAxiosError(404, { error: 'Profile not found' })))
        .mockReturnValueOnce(of(makeAxiosResponse({ authUrl: 'https://zernio.com/oauth/fresh' })));
      http.post.mockReturnValue(of(makeAxiosResponse({ profile: { _id: 'prof_FRESH', name: 'x' } })));
      prisma.user.update.mockResolvedValue({});

      const url = await service.generateConnectUrl(mockUser.id);

      expect(url).toBe('https://zernio.com/oauth/fresh');
      // stale fields cleared
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { zernioProfileId: null, zernioTiktokAccountId: null, tiktokLinked: false },
        }),
      );
      // fresh profile persisted, retry used it
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { zernioProfileId: 'prof_FRESH' } }),
      );
      expect(http.get.mock.calls[1][0]).toContain('profileId=prof_FRESH');
      expect(gateway.notifyRoom).toHaveBeenCalledWith(
        `user:${mockUser.id}`,
        'tiktok.link_changed',
        expect.objectContaining({ linked: false }),
      );
    });

    it('does not loop: a 404 on a freshly created profile rethrows', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, zernioProfileId: null });
      http.post.mockReturnValue(of(makeAxiosResponse({ profile: { _id: 'prof_NEW', name: 'x' } })));
      http.get.mockReturnValue(throwError(() => makeAxiosError(404, { error: 'Profile not found' })));
      prisma.user.update.mockResolvedValue({});

      await expect(service.generateConnectUrl(mockUser.id)).rejects.toBeDefined();
      // only the initial create — no recreate attempt
      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishPost', () => {
    const baseInput = {
      publishedPostId: 'pub-uuid',
      userId: mockUser.id,
      caption: 'Great post',
      tags: ['ai', 'tech'],
    };

    beforeEach(() => {
      prisma.publishedPost.findUnique.mockResolvedValue({
        id: 'pub-uuid',
        tiktokPublishId: null,
        status: 'pending',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        platformPostId: null,
      });
    });

    it('throws when user has no Zernio profile', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, zernioProfileId: null });
      await expect(
        service.publishPost({ ...baseInput, imageUrl: 'https://cdn.example.com/i.jpg' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when TikTok account not linked', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, tiktokLinked: false });
      await expect(
        service.publishPost({ ...baseInput, imageUrl: 'https://cdn.example.com/i.jpg' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when neither videoUrl nor imageUrl is provided', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.publishPost(baseInput)).rejects.toThrow(BadRequestException);
    });

    it('throws when both videoUrl and imageUrl are provided', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(
        service.publishPost({
          ...baseInput,
          videoUrl: 'https://cdn.example.com/v.mp4',
          imageUrl: 'https://cdn.example.com/i.jpg',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('publishes a video post and returns normalized result', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(
        of(
          makeAxiosResponse({
            post: {
              _id: 'zernio_post_1',
              status: 'scheduled',
              platformPostUrl: null,
            },
          }),
        ),
      );

      const result = await service.publishPost({
        ...baseInput,
        videoUrl: 'https://cdn.example.com/v.mp4',
        thumbnailUrl: 'https://cdn.example.com/cover.jpg',
      });

      expect(result).toEqual({
        postId: 'zernio_post_1',
        status: 'scheduled',
        publishedUrl: null,
      });
      const [, body] = http.post.mock.calls[0];
      expect(body.mediaItems).toEqual([{ type: 'video', url: 'https://cdn.example.com/v.mp4' }]);
      expect(body.platforms).toEqual([
        { platform: 'tiktok', accountId: mockUser.zernioTiktokAccountId },
      ]);
      expect(body.tiktokSettings.video_cover_image_url).toBe('https://cdn.example.com/cover.jpg');
      expect(body.tiktokSettings.allow_duet).toBe(true);
      expect(body.tiktokSettings.express_consent_given).toBe(true);
    });

    it('publishes a photo post with media_type=photo', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(
        of(
          makeAxiosResponse({
            post: { _id: 'zernio_post_2', status: 'published', platformPostUrl: 'https://tiktok.com/x' },
          }),
        ),
      );

      const result = await service.publishPost({
        ...baseInput,
        imageUrl: 'https://cdn.example.com/i.jpg',
      });

      expect(result).toEqual({
        postId: 'zernio_post_2',
        status: 'published',
        publishedUrl: 'https://tiktok.com/x',
      });
      const [, body] = http.post.mock.calls[0];
      expect(body.mediaItems[0]).toEqual({ type: 'image', url: 'https://cdn.example.com/i.jpg' });
      expect(body.tiktokSettings.media_type).toBe('photo');
      expect(body.tiktokSettings.allow_duet).toBe(false);
    });

    it('passes scheduledFor when scheduledAt is set', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(
        of(makeAxiosResponse({ post: { _id: 'p', status: 'scheduled' } })),
      );
      await service.publishPost({
        ...baseInput,
        imageUrl: 'https://cdn.example.com/i.jpg',
        scheduledAt: '2026-07-08T12:00:00Z',
      });
      const [, body] = http.post.mock.calls[0];
      expect(body.scheduledFor).toBe('2026-07-08T12:00:00Z');
    });

    it('returns existing record without re-publishing when tiktokPublishId is already set', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.publishedPost.findUnique.mockResolvedValue({
        id: 'pub-uuid',
        tiktokPublishId: 'zernio_existing',
        status: 'pending',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        platformPostId: 'https://tiktok.com/old',
      });
      const result = await service.publishPost({
        ...baseInput,
        imageUrl: 'https://cdn.example.com/i.jpg',
      });
      expect(result.postId).toBe('zernio_existing');
      expect(http.post).not.toHaveBeenCalled();
    });

    it('surfaces 401 from Zernio as UnauthorizedException', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(throwError(() => makeAxiosError(401, { error: 'bad key' })));
      await expect(
        service.publishPost({
          ...baseInput,
          imageUrl: 'https://cdn.example.com/i.jpg',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('persists tiktokPublishId immediately when Zernio accepts (non-published status)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(
        of(makeAxiosResponse({ post: { _id: 'zernio_post_3', status: 'scheduled' } })),
      );
      await service.publishPost({
        ...baseInput,
        imageUrl: 'https://cdn.example.com/i.jpg',
      });
      expect(prisma.publishedPost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pub-uuid' },
          data: expect.objectContaining({ tiktokPublishId: 'zernio_post_3' }),
        }),
      );
    });

    it('surfaces 409 from Zernio as ConflictException (not a raw 500)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(throwError(() => makeAxiosError(409, { error: 'duplicate' })));
      await expect(
        service.publishPost({
          ...baseInput,
          imageUrl: 'https://cdn.example.com/i.jpg',
        }),
      ).rejects.toThrow(ConflictException);
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 4xx errors (other than 401/403)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(throwError(() => makeAxiosError(400, { error: 'bad' })));
      await expect(
        service.publishPost({
          ...baseInput,
          imageUrl: 'https://cdn.example.com/i.jpg',
        }),
      ).rejects.toBeDefined();
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('retries on 5xx errors up to RETRY_DELAYS_MS.length+1 times', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      http.post.mockReturnValue(throwError(() => makeAxiosError(503)));
      // Make backoff sleeps instant so the test doesn't wait for real delays
      const setTimeoutSpy = jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((fn: (..._args: unknown[]) => void) => {
          fn();
          return 0 as unknown as NodeJS.Timeout;
        }) as unknown as typeof setTimeout);
      await expect(
        service.publishPost({
          ...baseInput,
          imageUrl: 'https://cdn.example.com/i.jpg',
        }),
      ).rejects.toBeDefined();
      expect(http.post).toHaveBeenCalledTimes(4);
      setTimeoutSpy.mockRestore();
    });
  });

  describe('validateWebhookSignature', () => {
    it('accepts a valid HMAC-SHA256 signature', () => {
      const body = Buffer.from('{"event":"post.published"}');
      const sig = createHmac('sha256', 'webhook-secret-xyz').update(body).digest('hex');
      expect(service.validateWebhookSignature(body, sig)).toBe(true);
    });

    it('rejects an invalid signature', () => {
      const body = Buffer.from('{"event":"post.published"}');
      const bad = 'a'.repeat(64);
      expect(service.validateWebhookSignature(body, bad)).toBe(false);
    });

    it('rejects empty signature', () => {
      expect(service.validateWebhookSignature(Buffer.from('{}'), '')).toBe(false);
    });
  });

  describe('validateInternalApiKey', () => {
    it('accepts the configured key', () => {
      expect(service.validateInternalApiKey('internal-key-abc')).toBe(true);
    });
    it('rejects a wrong key', () => {
      expect(service.validateInternalApiKey('wrong')).toBe(false);
    });
  });

  describe('broadcastPublishStatusChange', () => {
    it('emits publish.status_changed to the publish:<id> room', async () => {
      await service.broadcastPublishStatusChange({
        publishedPostId: 'pub-uuid-1',
        status: 'failed',
        errorMessage: 'Backend HTTP 401',
        stage: 'publish',
      });

      expect(gateway.notifyRoom).toHaveBeenCalledWith(
        'publish:pub-uuid-1',
        'publish.status_changed',
        expect.objectContaining({
          publishedPostId: 'pub-uuid-1',
          status: 'failed',
        }),
      );
    });

    it('does not leak the raw errorMessage into the broadcast payload', async () => {
      await service.broadcastPublishStatusChange({
        publishedPostId: 'pub-uuid-2',
        status: 'failed',
        errorMessage: 'sensitive backend trace',
      });

      const payload = gateway.notifyRoom.mock.calls[0][2];
      expect(payload).not.toHaveProperty('errorMessage');
    });

    it('emits non-failure status changes too', async () => {
      await service.broadcastPublishStatusChange({
        publishedPostId: 'pub-uuid-3',
        status: 'processing',
      });

      expect(gateway.notifyRoom).toHaveBeenCalledWith(
        'publish:pub-uuid-3',
        'publish.status_changed',
        expect.objectContaining({ status: 'processing' }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('marks user.tiktokLinked=true and stores accountId on account.connected', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue({});

      await service.handleWebhook({
        id: 'evt_1',
        event: 'account.connected',
        timestamp: '2026-05-05T00:00:00Z',
        account: {
          _id: 'acc_new',
          platform: 'tiktok',
          profileId: 'prof_abc',
        },
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tiktokLinked: true, zernioTiktokAccountId: 'acc_new' },
        }),
      );
      expect(gateway.notifyRoom).toHaveBeenCalledWith(
        'user:user-1',
        'tiktok.link_changed',
        expect.objectContaining({ linked: true }),
      );
    });

    it('updates publishedPost to published on post.published', async () => {
      prisma.publishedPost.findFirst.mockResolvedValue({ id: 'pub-1' });
      prisma.publishedPost.update.mockResolvedValue({});

      await service.handleWebhook({
        id: 'evt_2',
        event: 'post.published',
        timestamp: '2026-05-05T00:01:00Z',
        post: {
          _id: 'zernio_post_1',
          status: 'published',
          platforms: [
            {
              platform: 'tiktok',
              status: 'published',
              platformPostUrl: 'https://tiktok.com/@x/video/1',
            },
          ],
        },
      });

      expect(prisma.publishedPost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'published',
            platformPostId: 'https://tiktok.com/@x/video/1',
          }),
        }),
      );
      expect(gateway.notifyRoom).toHaveBeenCalledWith(
        'publish:pub-1',
        'publish.status_changed',
        expect.objectContaining({ status: 'published' }),
      );
    });

    it('marks publishedPost as failed on post.failed', async () => {
      prisma.publishedPost.findFirst.mockResolvedValue({ id: 'pub-1' });
      prisma.publishedPost.update.mockResolvedValue({});

      await service.handleWebhook({
        id: 'evt_3',
        event: 'post.failed',
        timestamp: '2026-05-05T00:02:00Z',
        post: {
          _id: 'zernio_post_1',
          status: 'failed',
          errorMessage: 'media rejected',
        },
      });

      expect(prisma.publishedPost.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', errorMessage: 'media rejected' }),
        }),
      );
    });

    it('short-circuits on a duplicate event id (Zernio retry) without re-processing', async () => {
      const p2002 = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      prisma.zernioWebhookEvent.create.mockRejectedValueOnce(p2002);

      await service.handleWebhook({
        id: 'evt_dup',
        event: 'post.published',
        timestamp: '2026-05-05T00:03:00Z',
        post: { _id: 'zernio_post_dup', status: 'published' },
      });

      expect(prisma.publishedPost.findFirst).not.toHaveBeenCalled();
      expect(prisma.publishedPost.update).not.toHaveBeenCalled();
      expect(gateway.notifyRoom).not.toHaveBeenCalled();
    });

    it('records the event id on first delivery so retries dedup', async () => {
      prisma.publishedPost.findFirst.mockResolvedValue({ id: 'pub-1' });
      prisma.publishedPost.update.mockResolvedValue({});

      await service.handleWebhook({
        id: 'evt_first',
        event: 'post.published',
        timestamp: '2026-05-05T00:04:00Z',
        post: { _id: 'zernio_post_first', status: 'published' },
      });

      expect(prisma.zernioWebhookEvent.create).toHaveBeenCalledWith({
        data: { eventId: 'evt_first', eventName: 'post.published' },
      });
    });
  });
});
