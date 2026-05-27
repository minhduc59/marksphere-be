import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from './decorators/current-user.decorator';
import {
  AuthTokensDto,
  CurrentUserDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from './dto/auth.dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a user with email+password credentials and returns an access/refresh token pair. Email must be unique.',
  })
  @ApiCreatedResponse({ type: AuthTokensDto, description: 'Account created.' })
  @ApiConflictResponse({ description: 'Email already in use.' })
  async register(@Body() dto: RegisterDto): Promise<AuthTokensDto> {
    return this.auth.register(dto);
  }

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in with email + password',
    description:
      'Validates credentials via the Passport local strategy and returns a fresh access/refresh token pair.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password.' })
  async login(
    @CurrentUser() user: CurrentUserPayload,
    @Body() _dto: LoginDto,
  ): Promise<AuthTokensDto> {
    return this.auth.login(user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Exchanges a valid refresh token for a new access/refresh pair. The old refresh token is invalidated (rotation).',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Refresh token is expired, revoked, or unknown.' })
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokensDto> {
    return this.auth.rotateRefreshToken(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a refresh token',
    description:
      'Explicitly revokes the supplied refresh token so it can no longer be used to mint new access tokens.',
  })
  @ApiNoContentResponse({ description: 'Refresh token revoked.' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.revokeRefreshToken(dto.refreshToken);
  }

  @ApiBearerAuth('access-token')
  @Get('me')
  @ApiOperation({
    summary: 'Get the authenticated user profile',
    description: 'Returns the user row for the current bearer token.',
  })
  @ApiOkResponse({ type: CurrentUserDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  async me(@CurrentUser() user: CurrentUserPayload) {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        tiktokLinked: true,
        createdAt: true,
      },
    });
    return row;
  }

  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google')
  @ApiOperation({
    summary: 'Start Google OAuth flow',
    description:
      'Redirects the browser to Google\'s consent screen. Not callable from Swagger UI — open the URL directly.',
  })
  googleLogin() {
    // Passport redirects to Google — no body needed.
  }

  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google/callback')
  @ApiExcludeEndpoint()
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const user = req.user as CurrentUserPayload;
    const tokens = await this.auth.login(user);
    res.json(tokens);
  }
}
