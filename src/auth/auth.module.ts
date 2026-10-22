import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { SupabaseJwtGuard } from './supabase-jwt.guard.js';
import { CsrfGuard } from './csrf.guard.js';
import { RolesGuard } from './roles.guard.js';
import { BranchAccessGuard } from './branch-access.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    SupabaseJwtGuard,
    CsrfGuard,
    RolesGuard,
    BranchAccessGuard,
  ],
  exports: [
    SupabaseJwtGuard,
    CsrfGuard,
    RolesGuard,
    BranchAccessGuard,
  ],
})
export class AuthModule {}
