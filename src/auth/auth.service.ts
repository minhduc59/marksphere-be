import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  TIKTOK_PUBLISHER,
  TikTokPublisher,
} from '../publisher/tiktok-publisher.interface';
import { CurrentUserPayload } from './decorators/current-user.decorator';
import { RegisterDto } from './dto/auth.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface GoogleProfile {
  googleSub: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(TIKTOK_PUBLISHER)
    private readonly publisher: TikTokPublisher,
  ) {}

  // -------------------------------------------------------------------
  // Registration + local login
  // -------------------------------------------------------------------

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        identities: {
          create: { provider: 'local', providerUserId: dto.email },
        },
      },
    });

    // Create publisher profile asynchronously — don't block registration on failure
    this.publisher
      .ensureProfile(user.id, user.email, user.displayName)
      .catch((err) =>
        this.logger.error(
          `publisher: profile creation failed for ${user.id}: ${(err as Error).message}`,
        ),
      );

    return this.issueTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
  }

  async validateLocalUser(
    email: string,
    password: string,
  ): Promise<CurrentUserPayload | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return null;
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) return null;
    return { userId: user.id, email: user.email, role: user.role };
  }

  async login(user: CurrentUserPayload): Promise<AuthTokens> {
    return this.issueTokens(user);
  }

  // -------------------------------------------------------------------
  // Google OAuth
  // -------------------------------------------------------------------

  async validateGoogleUser(profile: GoogleProfile): Promise<CurrentUserPayload> {
    // Look up an existing identity by (provider, providerUserId).
    const existing = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'google',
          providerUserId: profile.googleSub,
        },
      },
      include: { user: true },
    });
    if (existing) {
      return {
        userId: existing.user.id,
        email: existing.user.email,
        role: existing.user.role,
      };
    }

    // Merge by email — if someone previously registered with email+password
    // we link a new Google identity to the same user.
    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (byEmail) {
      await this.prisma.authIdentity.create({
        data: {
          userId: byEmail.id,
          provider: 'google',
          providerUserId: profile.googleSub,
        },
      });
      return { userId: byEmail.id, email: byEmail.email, role: byEmail.role };
    }

    // Fresh sign-up via Google.
    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        identities: {
          create: { provider: 'google', providerUserId: profile.googleSub },
        },
      },
    });
    return { userId: user.id, email: user.email, role: user.role };
  }

  // -------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------

  private async issueTokens(user: CurrentUserPayload): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.userId, email: user.email, role: user.role },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      },
    );

    const raw = randomBytes(48).toString('hex');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const ttlDays = 7;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId: user.userId, tokenHash, expiresAt },
    });

    return { accessToken, refreshToken: raw };
  }

  async rotateRefreshToken(raw: string): Promise<AuthTokens> {
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens({
      userId: record.user.id,
      email: record.user.email,
      role: record.user.role,
    });
  }

  async revokeRefreshToken(raw: string): Promise<void> {
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
