import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Characters allowed in human-facing names. Blocks control characters and
 * markup-significant characters while allowing common Unicode letters.
 */
const SAFE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} &'.,()/_-]*$/u;
const SAFE_PERSON_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'’-]*$/u;

/** URL-safe slug: lowercase alphanumerics separated by single hyphens. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class RegisterTenantDto {
  @ApiProperty({
    example: 'Acme Retail',
    minLength: 2,
    maxLength: 80,
    description: 'Display name of the new tenant (store/organisation).',
  })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  @Matches(SAFE_NAME_PATTERN, {
    message:
      "tenantName may only contain letters, numbers, spaces and & ' . , ( ) / _ -",
  })
  tenantName!: string;

  @ApiPropertyOptional({
    example: 'acme-retail',
    minLength: 3,
    maxLength: 50,
    description:
      'URL-safe tenant identifier. Derived from tenantName when omitted.',
  })
  @Transform(trimLower)
  @IsOptional()
  @IsString()
  @Length(3, 50)
  @Matches(TENANT_SLUG_PATTERN, {
    message:
      'slug must be 3-50 characters of lowercase letters, numbers and single hyphens',
  })
  slug?: string;

  @ApiProperty({
    example: 'Jane Doe',
    minLength: 2,
    maxLength: 100,
    description: 'Full name of the tenant OWNER.',
  })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  @Matches(SAFE_PERSON_NAME_PATTERN, {
    message: "fullName may only contain letters, numbers, spaces and . ' -",
  })
  fullName!: string;
}

export class RegisteredTenantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Acme Retail' })
  name!: string;

  @ApiProperty({ example: 'acme-retail' })
  slug!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class RegisteredOwnerDto {
  @ApiProperty({ format: 'uuid', description: 'Supabase Auth user id.' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ example: 'owner@acme.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  fullName!: string;

  @ApiProperty({ enum: GlobalRole, example: GlobalRole.OWNER })
  globalRole!: GlobalRole;
}

export class RegisterTenantResponseDto {
  @ApiProperty({ type: RegisteredTenantDto })
  tenant!: RegisteredTenantDto;

  @ApiProperty({ type: RegisteredOwnerDto })
  user!: RegisteredOwnerDto;
}
