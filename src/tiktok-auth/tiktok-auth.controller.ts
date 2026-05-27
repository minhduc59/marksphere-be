import { Controller, Get, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';

/**
 * TikTok OAuth is implemented in the FastAPI ai-service (it holds the
 * Fernet encryption key). The NestJS gateway just builds a stateful
 * redirect that includes the user's ID so the callback can link the
 * token row.
 */
@ApiTags('TikTok Auth')
@ApiBearerAuth('access-token')
@Controller('auth/tiktok')
export class TiktokAuthController {
  constructor(private readonly config: ConfigService) {}

  @Get('login')
  @Redirect()
  @ApiOperation({
    summary: 'Start TikTok OAuth flow',
    description:
      '302 redirect to ai-service which owns the TikTok OAuth credentials. Includes the current user ID as `state` so the callback can link the returned token to the correct user. Open in a browser — not callable from Swagger UI.',
  })
  login(@CurrentUser() user: CurrentUserPayload) {
    const base = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    return {
      url: `${base}/api/v1/auth/tiktok/login?state=${encodeURIComponent(user.userId)}`,
      statusCode: 302,
    };
  }
}
