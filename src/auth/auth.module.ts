import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { SupabaseJwtGuard } from './supabase-jwt.guard.js';
import { RegistrationAuthGuard } from './registration-auth.guard.js';
import { RegistrationService } from './registration.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { RolesGuard } from './roles.guard.js';
import { BranchAccessGuard } from './branch-access.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    SupabaseAuthService,
    SupabaseJwtGuard,
    RegistrationAuthGuard,
    RegistrationService,
    CsrfGuard,
    RolesGuard,
    BranchAccessGuard,
  ],
  exports: [
    // AppModule registers SupabaseJwtGuard as a global APP_GUARD, so its
    // dependency must be visible outside this module as well.
    SupabaseAuthService,
    SupabaseJwtGuard,
    CsrfGuard,
    RolesGuard,
    BranchAccessGuard,
  ],
})
export class AuthModule {}
