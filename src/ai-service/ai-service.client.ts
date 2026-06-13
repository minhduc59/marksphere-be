import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'node:crypto';

/**
 * Typed wrapper around the FastAPI ai-service.
 *
 * All calls inject the caller's userId into `X-User-Id` so the
 * Python service can enforce multi-user scoping, plus a shared
 * `X-Internal-Api-Key` so only the NestJS gateway can reach protected
 * endpoints.
 */
@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private headers(userId: string, extra: Record<string, string> = {}) {
    return {
      'X-User-Id': userId,
      'X-Internal-Api-Key': this.config.get<string>(
        'AI_SERVICE_INTERNAL_API_KEY',
        '',
      ),
      'X-Request-Id': extra['X-Request-Id'] ?? randomUUID(),
      ...extra,
    };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    userId: string,
    body?: unknown,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const cfg: AxiosRequestConfig = {
      method,
      url,
      data: body,
      params,
      headers: this.headers(userId),
    };
    try {
      const { data } = await firstValueFrom(this.http.request<T>(cfg));
      return data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const upstreamStatus = axiosErr.response?.status;
      const upstreamBody = axiosErr.response?.data;
      this.logger.error(
        `ai-service ${method} ${url} failed: ${upstreamStatus ?? axiosErr.message} ${JSON.stringify(upstreamBody)}`,
      );
      if (upstreamStatus) {
        throw new HttpException(
          upstreamBody ?? { message: axiosErr.message },
          upstreamStatus,
        );
      }
      throw new BadGatewayException('ai-service unreachable');
    }
  }

  // ---- Scan
  triggerScan(userId: string, body: unknown) {
    return this.request('POST', '/api/v1/scan', userId, body);
  }
  getScanStatus(userId: string, scanId: string) {
    return this.request('GET', `/api/v1/scan/${scanId}/status`, userId);
  }

  // ---- Posts
  generatePosts(userId: string, body: unknown) {
    return this.request('POST', '/api/v1/posts/generate', userId, body);
  }
  createPostFromArticle(userId: string, body: unknown) {
    return this.request('POST', '/api/v1/posts/from-article', userId, body);
  }
  regeneratePost(userId: string, postId: string, body: { feedback: string }) {
    return this.request(
      'POST',
      `/api/v1/posts/${postId}/regenerate`,
      userId,
      body,
    );
  }
  deletePost(userId: string, postId: string) {
    return this.request('DELETE', `/api/v1/posts/${postId}`, userId);
  }

  // ---- Publish
  publishNow(userId: string, postId: string, body: unknown) {
    return this.request('POST', `/api/v1/publish/${postId}`, userId, body);
  }
  schedulePublish(userId: string, postId: string, body: unknown) {
    return this.request(
      'POST',
      `/api/v1/publish/${postId}/schedule`,
      userId,
      body,
    );
  }
  autoPublish(userId: string, postId: string, body: unknown) {
    return this.request('POST', `/api/v1/publish/${postId}/auto`, userId, body);
  }
  cancelScheduled(userId: string, postId: string) {
    return this.request('DELETE', `/api/v1/publish/${postId}/schedule`, userId);
  }
  getPublishStatus(userId: string, publishedPostId: string) {
    return this.request(
      'GET',
      `/api/v1/publish/${publishedPostId}/status`,
      userId,
    );
  }
  getGoldenHours(userId: string) {
    return this.request('GET', '/api/v1/publish/golden-hours', userId);
  }

  // ---- Engagement time slots (used by golden hour)
  listTimeSlots(userId: string, platform?: string) {
    return this.request(
      'GET',
      '/api/v1/time-slots',
      userId,
      undefined,
      platform ? { platform } : undefined,
    );
  }
  createTimeSlot(userId: string, body: unknown) {
    return this.request('POST', '/api/v1/time-slots', userId, body);
  }
  updateTimeSlot(userId: string, slotId: string, body: unknown) {
    return this.request('PATCH', `/api/v1/time-slots/${slotId}`, userId, body);
  }
  deleteTimeSlot(userId: string, slotId: string) {
    return this.request('DELETE', `/api/v1/time-slots/${slotId}`, userId);
  }

  // ---- Video Tasks
  triggerVideoPipeline(userId: string, taskId: string) {
    return this.request('POST', `/api/v1/video-tasks/${taskId}/run`, userId);
  }

  // ---- Video Clips (Clips Library)
  listVideoClips(userId: string, params: Record<string, unknown>) {
    return this.request('GET', '/api/v1/video-clips', userId, undefined, params);
  }
  deleteVideoClip(userId: string, clipId: string) {
    return this.request('DELETE', `/api/v1/video-clips/${clipId}`, userId);
  }
  duplicateVideoClip(userId: string, clipId: string) {
    return this.request('POST', `/api/v1/video-clips/${clipId}/duplicate`, userId);
  }

  // ---- Pipeline Runs (end-to-end pipeline orchestration)
  triggerPipelineRun(userId: string, body: unknown) {
    return this.request('POST', '/api/v1/pipeline/runs', userId, body);
  }
  listPipelineRuns(userId: string, params: Record<string, unknown>) {
    return this.request(
      'GET',
      '/api/v1/pipeline/runs',
      userId,
      undefined,
      params,
    );
  }
  getPipelineRunStatus(userId: string, pipelineId: string) {
    return this.request(
      'GET',
      `/api/v1/pipeline/runs/${pipelineId}/status`,
      userId,
    );
  }

  // ---- Pipeline Config
  getPipelineConfig(userId: string) {
    return this.request('GET', '/api/v1/pipeline/config', userId);
  }
  getPipelineSchedule(userId: string) {
    return this.request('GET', '/api/v1/pipeline/schedule', userId);
  }
  createPipelineConfig(userId: string, body: unknown) {
    return this.request('POST', '/api/v1/pipeline/config', userId, body);
  }
  patchPipelineConfig(userId: string, body: unknown) {
    return this.request('PATCH', '/api/v1/pipeline/config', userId, body);
  }
}
