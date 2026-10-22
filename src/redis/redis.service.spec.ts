import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisService } from './redis.service.js';
import type { EnvConfig } from '../config/env.config.js';

// ioredis exports Redis as a class. Vitest vi.fn() alone is not a valid
// constructor — we must mock the module with a proper class so `new Redis()`
// works correctly inside RedisService.
const mockRedisInstance = {
  on: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
  ping: vi.fn(),
  quit: vi.fn().mockResolvedValue('OK'),
};

vi.mock('ioredis', () => {
  class MockRedis {
    on = mockRedisInstance.on;
    get = mockRedisInstance.get;
    set = mockRedisInstance.set;
    del = mockRedisInstance.del;
    scan = mockRedisInstance.scan;
    ping = mockRedisInstance.ping;
    quit = mockRedisInstance.quit;
  }
  return { Redis: MockRedis };
});

describe('RedisService', () => {
  let service: RedisService;
  const mockConfig: EnvConfig = {
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgresql://localhost:5432/db',
    DIRECT_URL: 'postgresql://localhost:5432/db',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    PORT: 4000,
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    SENTRY_DSN: '',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore quit default after clearAllMocks wipes the resolved value.
    mockRedisInstance.quit.mockResolvedValue('OK');
    service = new RedisService(mockConfig);
  });

  describe('getJson', () => {
    it('returns parsed JSON when key exists', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(JSON.stringify({ user: 'alice' }));

      const result = await service.getJson<{ user: string }>('sk:user:1');

      expect(mockRedisInstance.get).toHaveBeenCalledWith('sk:user:1');
      expect(result).toEqual({ user: 'alice' });
    });

    it('returns null when key does not exist', async () => {
      mockRedisInstance.get.mockResolvedValueOnce(null);

      const result = await service.getJson('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when JSON is corrupt', async () => {
      mockRedisInstance.get.mockResolvedValueOnce('invalid json {');

      const result = await service.getJson('corrupt');

      expect(result).toBeNull();
    });
  });

  describe('setJson', () => {
    it('serializes and stores data with TTL', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK');

      await service.setJson('sk:data:1', { active: true }, 120);

      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'sk:data:1',
        JSON.stringify({ active: true }),
        'EX',
        120,
      );
    });
  });

  describe('del', () => {
    it('calls del with given keys and returns deleted count', async () => {
      mockRedisInstance.del.mockResolvedValueOnce(2);

      const count = await service.del('key-1', 'key-2');

      expect(mockRedisInstance.del).toHaveBeenCalledWith('key-1', 'key-2');
      expect(count).toBe(2);
    });

    it('returns 0 when keys array is empty without calling redis del', async () => {
      const count = await service.del();
      expect(count).toBe(0);
      expect(mockRedisInstance.del).not.toHaveBeenCalled();
    });
  });

  describe('delPattern', () => {
    it('scans and deletes matched keys iteratively', async () => {
      mockRedisInstance.scan
        .mockResolvedValueOnce(['42', ['key:1', 'key:2']])
        .mockResolvedValueOnce(['0', ['key:3']]);
      mockRedisInstance.del
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);

      const totalDeleted = await service.delPattern('key:*');

      expect(mockRedisInstance.scan).toHaveBeenCalledTimes(2);
      expect(mockRedisInstance.del).toHaveBeenCalledWith('key:1', 'key:2');
      expect(mockRedisInstance.del).toHaveBeenCalledWith('key:3');
      expect(totalDeleted).toBe(3);
    });
  });

  describe('ping', () => {
    it('returns true when ping responds with PONG', async () => {
      mockRedisInstance.ping.mockResolvedValueOnce('PONG');

      const result = await service.ping();

      expect(result).toBe(true);
    });

    it('returns false when ping throws or returns other response', async () => {
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.ping();

      expect(result).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects redis client cleanly', async () => {
      await service.onModuleDestroy();
      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });
  });
});
