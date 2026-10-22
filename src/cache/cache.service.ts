import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

/**
 * Cache-aside helper with NX-lock stampede protection.
 *
 * Key taxonomy (all prefixed with sk:):
 *   sk:user:profile:{userId}          → 5min
 *   sk:auth:jwks                      → 1h
 *   sk:stock:{branchId}:{productId}:{variantId} → 5min
 *   sk:stock:list:{branchId}:{hash}   → 60s
 *   sk:product:{productId}            → 5min
 *   sk:product:list:{tenantId}:{hash} → 5min
 *   sk:analytics:{type}:{branchId}:{from}:{to} → 5min
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private static readonly LOCK_TTL = 5; // seconds

  constructor(private readonly redis: RedisService) {}

  /**
   * Cache-aside with stampede protection via NX lock.
   * If the cache is empty, only one caller computes the value;
   * others wait briefly and retry.
   */
  async remember<T>(
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    // Try cache first
    const cached = await this.redis.getJson<T>(key);
    if (cached !== null) return cached;

    // Try to acquire lock
    const lockKey = `${key}:lock`;
    const acquired = await this.redis.client.set(
      lockKey,
      '1',
      'EX',
      CacheService.LOCK_TTL,
      'NX',
    );

    if (acquired === 'OK') {
      try {
        // We won the lock — compute and cache
        const value = await factory();
        await this.redis.setJson(key, value, ttlSeconds);
        return value;
      } finally {
        await this.redis.del(lockKey);
      }
    }

    // Another caller holds the lock — wait briefly and retry from cache
    await new Promise((r) => setTimeout(r, 200));
    const retried = await this.redis.getJson<T>(key);
    if (retried !== null) return retried;

    // Lock holder may have failed — compute ourselves
    this.logger.warn(`Stampede fallback for key: ${key}`);
    const value = await factory();
    await this.redis.setJson(key, value, ttlSeconds);
    return value;
  }

  /** Delete a specific cache key */
  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /** Delete all keys matching a glob pattern */
  async delPattern(pattern: string): Promise<void> {
    await this.redis.delPattern(pattern);
  }
}
