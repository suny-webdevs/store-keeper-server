import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { ErrorCode, type RequestUser } from '../common/types.js';
import {
  RegisterTenantDto,
  RegisterTenantResponseDto,
} from './dto/register-tenant.dto.js';
import { RegistrationAuthGuard } from './registration-auth.guard.js';
import { RegistrationService } from './registration.service.js';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly registrationService: RegistrationService) {}

  /**
   * GET /v1/auth/me
   * Returns the authenticated user's profile (from JWT + DB).
   * Already populated by SupabaseJwtGuard on req.user.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ description: 'Current user profile' })
  getMe(@Req() req: Request): RequestUser {
    return req.user!;
  }

  /**
   * POST /v1/auth/register
   *
   * Step 2 of sign-up: the client has already created the account with
   * Supabase Auth and presents the resulting access token. This endpoint
   * verifies that token (and the verified e-mail) and atomically creates
   * the tenant plus its OWNER profile.
   *
   * Marked @Public() so the global JWT guard does not reject a valid
   * Supabase user who has no local profile yet; RegistrationAuthGuard
   * performs the actual authentication. CSRF is not applicable because
   * this endpoint authenticates with a Bearer token and sets no cookies.
   */
  @Public()
  @UseGuards(RegistrationAuthGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Register a new tenant and its OWNER account',
    description:
      'Requires a valid Supabase access token for a user with a verified email. ' +
      'The tenant and OWNER profile are created atomically. The OWNER role is assigned server-side.',
  })
  @ApiCreatedResponse({
    description: 'Tenant and owner created',
    type: RegisterTenantResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or invalid Supabase access token',
  })
  @ApiForbiddenResponse({
    description: 'Email not verified, email missing, or registration disabled',
  })
  @ApiConflictResponse({
    description:
      'Account already registered, email already in use, or tenant slug taken',
  })
  @ApiTooManyRequestsResponse({
    description: 'Registration rate limit exceeded',
  })
  @ApiServiceUnavailableResponse({
    description: 'Supabase Auth could not be reached to verify the account',
  })
  async register(
    @Body() dto: RegisterTenantDto,
    @Req() req: Request,
  ): Promise<RegisterTenantResponseDto> {
    const identity = req.registrationIdentity;
    if (!identity) {
      // Defence in depth: the route guard must always populate this.
      throw new UnauthorizedException({
        message: 'Authentication required',
        code: ErrorCode.AUTH_REQUIRED,
      });
    }

    return this.registrationService.register(dto, identity, {
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
