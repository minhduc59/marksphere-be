import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export type AdminUserRole = 'admin' | 'user';

export class CreateUserDto {
  @ApiProperty({ example: 'user4@gmail.com' })
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

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ enum: ['admin', 'user'], default: 'user' })
  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: AdminUserRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ['admin', 'user'] })
  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: AdminUserRole;

  @ApiPropertyOptional({ example: 'Jane Doe', nullable: true })
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class AdminUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiPropertyOptional({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ enum: ['admin', 'user'] }) role!: AdminUserRole;
  @ApiProperty() tiktokLinked!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty() postsGenerated!: number;
  @ApiProperty() postsPublished!: number;
  @ApiProperty() videoClips!: number;
}

export class AdminUsersPageDto {
  @ApiProperty({ type: [AdminUserDto] }) items!: AdminUserDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class AdminUserStatsDto {
  @ApiProperty() totalUsers!: number;
  @ApiProperty() tiktokLinked!: number;
  @ApiProperty() tiktokNotLinked!: number;
  @ApiProperty() newThisWeek!: number;
  @ApiProperty({ nullable: true }) deltaPct!: number | null;
}
