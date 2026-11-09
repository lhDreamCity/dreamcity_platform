/**
 * 文件访问 —— 私有读 + 签名 URL（设计方案 §7.3）
 *
 * 作品与课件不走公开目录：所有访问都要带一个短时效签名。
 */

import type { FastifyInstance } from 'fastify';
import { getObjectStore, verifySignedFile } from '../../lib/storage.js';

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/files/*', async (req, reply) => {
    const raw = (req.params as { '*': string })['*'];
    if (!raw) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });

    const query = req.query as { t?: string; sig?: string };
    if (!verifySignedFile(raw, query.t, query.sig)) {
      // 签名无效或过期：不给 403，直接 404（不泄露文件是否存在）
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    const store = await getObjectStore();
    const body = await store.get(raw);
    if (!body) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });

    const dot = raw.lastIndexOf('.');
    const ext = dot < 0 ? '' : raw.slice(dot).toLowerCase();
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
    };
    reply.header('Content-Type', types[ext] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(body);
  });
}
