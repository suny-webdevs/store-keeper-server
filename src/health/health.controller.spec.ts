import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: Partial<PrismaService>;
  let mockRedis: Partial<RedisService>;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn(),
    };
    mockRedis = {
      ping: vi.fn(),
    };
    controller = new HealthController(
      mockPrisma as PrismaService,
      mockRedis as RedisService,
    );
  });

  describe('getLiveness', () => {
    it('returns alive status with uptime and timestamp', () => {
      const result = controller.getLiveness();
      expect(result.status).toBe('ok');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('getReadiness', () => {
    it('returns ready status when database and redis are healthy', async () => {
      vi.mocked(mockPrisma.$queryRaw!).mockResolvedValueOnce([{ '?column?': 1 }]);
      vi.mocked(mockRedis.ping!).mockResolvedValueOnce(true);

      const result = await controller.getReadiness();

      expect(result.status).toBe('ready');
      expect(result.database).toBe('up');
      expect(result.redis).toBe('up');
      expect(typeof result.timestamp).toBe('string');
    });

    it('throws ServiceUnavailableException when database check fails', async () => {
      vi.mocked(mockPrisma.$queryRaw!).mockRejectedValueOnce(new Error('DB unreachable'));
      vi.mocked(mockRedis.ping!).mockResolvedValueOnce(true);

      await expect(controller.getReadiness()).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when redis check fails', async () => {
      vi.mocked(mockPrisma.$queryRaw!).mockResolvedValueOnce([{ '?column?': 1 }]);
      vi.mocked(mockRedis.ping!).mockResolvedValueOnce(false);

      await expect(controller.getReadiness()).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when both database and redis fail', async () => {
      vi.mocked(mockPrisma.$queryRaw!).mockRejectedValueOnce(new Error('Connection lost'));
      vi.mocked(mockRedis.ping!).mockRejectedValueOnce(new Error('Redis timeout'));

      await expect(controller.getReadiness()).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
