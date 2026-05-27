import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { ZernioService } from './zernio.service';
import { InternalPublishDto } from './dto/internal-publish.dto';
import { InternalStatusNotifyDto } from './dto/internal-status-notify.dto';

@ApiTags('Publisher')
@Controller('publisher')
export class ZernioController {
  private readonly logger = new Logger(ZernioController.name);

  constructor(private readonly zernio: ZernioService) {}

  @Get('tiktok/callback')
  @Public()
  @Redirect('', 302)
  @ApiOperation({
    summary: '[Public] TikTok OAuth callback',
    description:
      'Zernio redirects here after the user authorizes TikTok. Fetches the connected account from Zernio, ' +
      'persists its _id to the database, then redirects to the frontend settings page.',
  })
  async tiktokCallback(@Query('profileId') profileId: string) {
    const url = await this.zernio.handleTikTokCallback(profileId ?? '');
    return { url };
  }

  @Get('tiktok/link-url')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get TikTok account linking URL',
    description:
      'Returns a Zernio OAuth `authUrl` for connecting a TikTok account to the user’s Zernio profile. ' +
      'Open it in a new tab; on success Zernio sends an `account.connected` webhook.',
  })
  async getTikTokLinkUrl(@CurrentUser() user: CurrentUserPayload) {
    const url = await this.zernio.generateConnectUrl(user.userId);
    return { url };
  }

  @Post('profiles')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Ensure Zernio profile exists for the current user',
    description:
      'Idempotent — safe to call multiple times. The profile is also created automatically on registration.',
  })
  async ensureProfile(@CurrentUser() user: CurrentUserPayload) {
    const profileId = await this.zernio.ensureProfile(user.userId, user.email);
    return { profileId: profileId.slice(0, 8) + '***' };
  }

  @Delete('internal/cancel-scheduled/:publishedPostId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Internal] Cancel a Zernio scheduled post',
    description:
      'Called by ai-service when a scheduled publish is cancelled or superseded by publish-now. ' +
      'Requires X-Internal-Api-Key header. Non-fatal if no Zernio post ID exists yet.',
  })
  @ApiParam({ name: 'publishedPostId', description: 'UUID of the PublishedPost record.' })
  async internalCancelScheduled(
    @Headers('x-internal-api-key') apiKey: string,
    @Param('publishedPostId') publishedPostId: string,
  ) {
    if (!this.zernio.validateInternalApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    try {
      await this.zernio.cancelScheduled(publishedPostId);
    } catch (err) {
      // Non-fatal: post may not have been submitted to Zernio yet
      this.logger.warn(
        `zernio: internalCancelScheduled failed for ${publishedPostId}: ${(err as Error).message}`,
      );
    }
    return { cancelled: true };
  }

  @Post('internal/publish')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Internal] Publish post via Zernio',
    description:
      'Called by the ai-service LangGraph Publish Post Agent. Requires X-Internal-Api-Key header. ' +
      'Provide either `videoUrl` (+ optional `thumbnailUrl`) or `imageUrl`.',
  })
  @ApiBody({ type: InternalPublishDto })
  async internalPublish(
    @Headers('x-internal-api-key') apiKey: string,
    @Body() dto: InternalPublishDto,
  ) {
    if (!this.zernio.validateInternalApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    const result = await this.zernio.publishPost({
      publishedPostId: dto.publishedPostId,
      userId: dto.userId,
      caption: dto.caption,
      title: dto.title,
      tags: dto.tags,
      videoUrl: dto.videoUrl,
      thumbnailUrl: dto.thumbnailUrl,
      imageUrl: dto.imageUrl,
      scheduledAt: dto.scheduledAt,
    });
    return { ...result, publishedPostId: dto.publishedPostId };
  }

  @Post('internal/notify-status')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '[Internal] Broadcast publish status change to subscribed clients',
    description:
      'Called by ai-service when the publish pipeline reaches a terminal state ' +
      '(typically failure). Requires X-Internal-Api-Key header. Triggers a ' +
      'publish.status_changed WebSocket event on room publish:<publishedPostId>.',
  })
  @ApiBody({ type: InternalStatusNotifyDto })
  async internalNotifyStatus(
    @Headers('x-internal-api-key') apiKey: string,
    @Body() dto: InternalStatusNotifyDto,
  ) {
    if (!this.zernio.validateInternalApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    await this.zernio.broadcastPublishStatusChange({
      publishedPostId: dto.publishedPostId,
      status: dto.status,
      errorMessage: dto.errorMessage,
      stage: dto.stage,
    });
  }

  @Post('publish/:publishedPostId/now')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a scheduled post so the caller can publish it immediately',
    description:
      'Cancels the Zernio scheduled post and clears scheduling state. The caller must re-trigger ' +
      'the publish pipeline (which re-resolves media + caption) to actually publish.',
  })
  @ApiParam({ name: 'publishedPostId', description: 'UUID of the PublishedPost record' })
  async publishNow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('publishedPostId') publishedPostId: string,
  ) {
    await this.zernio.publishNow(user.userId, publishedPostId);
    return { ok: true };
  }

  @Post('webhooks')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Public] Zernio webhook endpoint',
    description:
      'Receives account.connected/disconnected and post.* events from Zernio. ' +
      'Validates the X-Zernio-Signature HMAC-SHA256 header against the raw body.',
  })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-zernio-signature') signature: string,
    @Body() body: Record<string, unknown>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      // main.ts sets rawBody:true on NestFactory.create — if this is missing
      // something has regressed and we cannot verify the signature. Refuse the
      // event rather than letting an unverified webhook update the database.
      this.logger.error(
        'zernio webhook: rawBody unavailable — refusing (check main.ts rawBody:true)',
      );
      throw new UnauthorizedException('Cannot verify webhook signature');
    }
    if (!this.zernio.validateWebhookSignature(rawBody, signature)) {
      this.logger.warn('zernio webhook: invalid signature, rejecting');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.zernio.handleWebhook(body);
    return { received: true };
  }
}
