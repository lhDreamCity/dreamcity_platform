/**
 * 鉴权守卫 —— 三种身份严格隔离（设计方案 §7.3）
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, type TokenPayload } from '../lib/auth.js';
import type { Viewer } from '../modules/visibility/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    viewer?: Viewer;
    token?: TokenPayload;
  }
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value;
}

function unauthorized(reply: FastifyReply, message = '请先登录') {
  return reply.code(401).send({ error: 'UNAUTHORIZED', message });
}

/** 讲师 / 运营 / 管理员 */
export async function requireStaff(req: FastifyRequest, reply: FastifyReply) {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== 'staff') return unauthorized(reply);
  req.token = payload;
  req.viewer = { role: 'staff', id: payload.sub };
  return undefined;
}

/** 家长 */
export async function requireGuardian(req: FastifyRequest, reply: FastifyReply) {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== 'guardian') return unauthorized(reply);
  req.token = payload;
  req.viewer = { role: 'guardian', id: payload.sub };
  return undefined;
}

/** 学员（课堂码换来的短时效凭证） */
export async function requireStudent(req: FastifyRequest, reply: FastifyReply) {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== 'student') return unauthorized(reply);
  req.token = payload;
  req.viewer = { role: 'student', id: payload.sub };
  return undefined;
}

export function currentViewer(req: FastifyRequest): Viewer {
  if (!req.viewer) throw new Error('缺少 viewer：路由忘了挂守卫');
  return req.viewer;
}
