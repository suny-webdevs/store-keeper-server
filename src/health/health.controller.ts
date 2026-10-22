import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

@ApiTags('Health')
@Controller('v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * GET /v1/health
   * Liveness probe (no DB/Redis dependency).
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness check (no external dependencies)' })
  @ApiOkResponse({ description: 'Service is alive' })
  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /**
   * GET /v1/health/ready
   * Readiness probe — pings both Postgres and Redis.
   */
  @Public()
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness check (Postgres + Redis ping)' })
  @ApiOkResponse({ description: 'Service is ready to handle traffic' })
  async getReadiness() {
    let dbOk = false;
    let redisOk = false;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    try {
      redisOk = await this.redis.ping();
    } catch {
      redisOk = false;
    }

    if (!dbOk || !redisOk) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service dependencies are unavailable',
        database: dbOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down',
      });
    }

    return {
      status: 'ready',
      database: 'up',
      redis: 'up',
      timestamp: new Date().toISOString(),
    };
  }
}
