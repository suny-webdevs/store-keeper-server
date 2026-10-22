import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Req } from '@nestjs/common';
import type { RequestUser } from '../common/types.js';

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  /**
   * GET /v1/auth/me
   * Returns the authenticated user's profile (from JWT + DB).
   * Already populated by SupabaseJwtGuard on req.user.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiOkResponse({ description: 'Current user profile' })
  getMe(@Req() req: Request): RequestUser {
    return req.user!;
  }
}
