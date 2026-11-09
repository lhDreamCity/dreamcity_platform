/**
 * 限流 —— 用缓存做计数器
 *
 * 上云的基本要求：公开接口必须有速率限制。
 * 课堂码是 6 位数字（100 万组合）、短信验证码 5 位（10 万组合），
 * 没有限流就等于把凭证敞开让人试。
 */

import { getCache, cacheKeys } from './cache.js';

export interface RateLimitResult {
  allowed: boolean;
  /** 距离窗口重置还有多少秒 */
  retryAfter: number;
  limit: number;
  remaining: number;
}

/**
 * 固定窗口计数。
 * `key` 决定计数维度（一般用 IP 或手机号）。
 */
export async function rateLimit(
  bucket: string,
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const cache = await getCache();
  const key = cacheKeys.rateLimit(bucket, id);
  const count = await cache.incr(key, windowSeconds);
  return {
    allowed: count <= limit,
    retryAfter: windowSeconds,
    limit,
    remaining: Math.max(0, limit - count),
  };
}

/** 从请求里取一个用于限流的客户端标识 */
export function clientKey(req: { ip: string; headers: Record<string, unknown> }): string {
  return req.ip || 'unknown';
}
