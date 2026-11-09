/**
 * 缓存接口 —— 课堂码 / 会话 / 限流
 *
 * 生产用 Redis；本地开发用进程内 Map + TTL 兜底
 * （开发上下文 §7.2：首期一台机器、一次部署，一个日志）。
 */

import { env } from '../env.js';

export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** 原子取值并删除（一次性凭证用） */
  take(key: string): Promise<string | null>;
  /** 原子自增并设置过期（限流计数器用），返回自增后的值 */
  incr(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: string; expiresAt: number }>();

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) this.store.delete(k);
    }
  }

  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.store.size > 1000) this.sweep();
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async take(key: string): Promise<string | null> {
    const v = await this.get(key);
    if (v !== null) await this.del(key);
    return v;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = Number((await this.get(key)) ?? 0);
    const next = current + 1;
    await this.set(key, String(next), ttlSeconds);
    return next;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

class RedisCache implements Cache {
  constructor(private client: RedisClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async take(key: string): Promise<string | null> {
    const key2 = `take:${key}`;
    const script = `local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v`;
    return (await this.client.eval(script, 1, key2)) as string | null;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

/** ioredis 的最小接口面，避免把具体类型泄进业务代码 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

let instance: Cache | null = null;

export async function getCache(): Promise<Cache> {
  if (instance) return instance;
  if (env.redisUrl) {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(env.redisUrl) as unknown as RedisClient;
    instance = new RedisCache(client);
  } else {
    instance = new MemoryCache();
  }
  return instance;
}

/* ── 课堂码相关 key ─────────────────────────────────────────── */

export const cacheKeys = {
  classCode: (code: string) => `dc:classcode:${code}`,
  classCodeSession: (sessionId: string) => `dc:session:${sessionId}:classcode`,
  smsCode: (phone: string) => `dc:sms:${phone}`,
  smsAttempts: (phone: string) => `dc:sms-attempts:${phone}`,
  studentSession: (studentId: string, sessionId: string) => `dc:student:${studentId}:${sessionId}`,
  rateLimit: (bucket: string, id: string) => `dc:rl:${bucket}:${id}`,
};
