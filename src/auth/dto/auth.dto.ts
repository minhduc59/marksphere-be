import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    example: 'user1@gmail.com',
    description: 'Email address used as the unique account identifier.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '@User123',
    minLength: 8,
    description: 'Plaintext password (min 8 chars). Hashed with bcrypt server-side.',
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    example: 'Jane Doe',
    description: 'Optional display name shown in the UI.',
  })
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple' })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @ApiProperty({
    description:
      'Opaque refresh token issued alongside an access token. Rotated on use.',
    example: '2f8c9a1e7b...long-opaque-string...',
  })
  @IsString()
  refreshToken!: string;
}

export class AuthTokensDto {
  @ApiProperty({
    description: 'Short-lived JWT. Send as `Authorization: Bearer <token>`.',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Opaque refresh token. Exchange via `POST /auth/refresh`.',
  })
  refreshToken!: string;
}

export class CurrentUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) displayName?: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl?: string | null;
  @ApiProperty({ enum: ['admin', 'user'] }) role!: 'admin' | 'user';
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}
