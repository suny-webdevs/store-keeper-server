import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from './cache.service.js';
import type { RedisService } from '../redis/redis.service.js';

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: Partial<RedisService>;
  let setSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setSpy = vi.fn();
    mockRedis = {
      getJson: vi.fn(),
      setJson: vi.fn(),
      del: vi.fn(),
      delPattern: vi.fn(),
      client: {
        set: setSpy,
      } as any,
    };
    service = new CacheService(mockRedis as RedisService);
  });

  it('returns cached value without acquiring lock if cache hits', async () => {
    vi.mocked(mockRedis.getJson!).mockResolvedValue({ hello: 'world' });
    const factory = vi.fn();

    const result = await service.remember('test-key', 60, factory);

    expect(result).toEqual({ hello: 'world' });
    expect(factory).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('acquires NX lock, computes value, caches it, and releases lock on cache miss', async () => {
    vi.mocked(mockRedis.getJson!).mockResolvedValue(null);
    setSpy.mockResolvedValue('OK');
    const factory = vi.fn().mockResolvedValue({ computed: true });

    const result = await service.remember('test-key', 60, factory);

    expect(result).toEqual({ computed: true });
    expect(setSpy).toHaveBeenCalledWith(
      'test-key:lock',
      '1',
      'EX',
      5,
      'NX',
    );
    expect(mockRedis.setJson).toHaveBeenCalledWith('test-key', { computed: true }, 60);
    expect(mockRedis.del).toHaveBeenCalledWith('test-key:lock');
  });

  it('waits and retries from cache if lock is held by another worker', async () => {
    vi.mocked(mockRedis.getJson!)
      .mockResolvedValueOnce(null) // first check
      .mockResolvedValueOnce({ resolvedByOther: true }); // after wait
    setSpy.mockResolvedValue(null); // lock failed

    const factory = vi.fn();
    const result = await service.remember('test-key', 60, factory);

    expect(result).toEqual({ resolvedByOther: true });
    expect(factory).not.toHaveBeenCalled();
  });

  it('calls del on redis service', async () => {
    await service.del('key1', 'key2');
    expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2');
  });

  it('calls delPattern on redis service', async () => {
    await service.delPattern('sk:stock:*');
    expect(mockRedis.delPattern).toHaveBeenCalledWith('sk:stock:*');
  });
});
