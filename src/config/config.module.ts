import { Global, Module } from '@nestjs/common';
import { validateEnv, type EnvConfig } from './env.config.js';

export const ENV_CONFIG = Symbol('ENV_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: ENV_CONFIG,
      useFactory: (): EnvConfig => validateEnv(),
    },
  ],
  exports: [ENV_CONFIG],
})
export class ConfigModule {}
