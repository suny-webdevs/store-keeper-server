import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Global()
@Module({
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
