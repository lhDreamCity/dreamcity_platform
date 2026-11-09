/**
 * Fastify 应用骨架
 *
 * 单一数据与身份权威（开发上下文 §5）。三端同域不同路径。
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { env } from './env.js';
import { NotFoundError } from './modules/visibility/service.js';

export type { FastifyInstance, FastifyReply, FastifyRequest };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** 打包好的前端（生产由后端直接托管，免一个 Nginx location） */
const WEB_DIST = resolve(env.root, 'packages/web/dist');

function shouldServeWeb(): boolean {
  if (env.serveWeb === 'true') return true;
  if (env.serveWeb === 'false') return false;
  // auto：打包产物存在就托管
  return existsSync(join(WEB_DIST, 'index.html'));
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.isProd ? 'info' : 'warn',
    },
    // 生产在 Nginx 后面，要拿到真实客户端 IP（限流要用）
    trustProxy: env.isProd,
  });

  await app.register(cors, {
    // 生产只放行配置好的域名；开发允许全部
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  /**
   * JSON 解析：空 body 当成空对象。
   *
   * Fastify 默认会因为「声明了 application/json 但 body 为空」而报 400，
   * 客户端（尤其是 DELETE / POST 不带 body 时）会收到
   * "Body cannot be empty when content-type is set to 'application/json'" —— 很难排查。
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || body.trim() === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // ── 安全响应头 ──────────────────────────────────────
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // 平台是封闭域，不应被搜索引擎收录（设计方案 §7.3）
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (env.isProd) {
      reply.header(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
  });

  // 活动插件静态托管（零 CDN 的单文件 HTML）
  await app.register(fastifyStatic, {
    root: resolve(env.root, 'activities'),
    prefix: '/activities/',
    decorateReply: false,
  });
  // 课件与作品不走公开目录：由 modules/files/routes.ts 带签名校验后从对象存储取

  // ── 统一错误处理：越权一律 404，不泄露资源存在性（C7）──
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: error.message });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({
      error: status >= 500 ? 'INTERNAL' : 'REQUEST_ERROR',
      message: status >= 500 ? '出了点小状况' : error.message,
    });
  });

  // ── 前端静态资源（SPA）────────────────────────────────
  const serveWeb = shouldServeWeb();
  if (serveWeb) {
    // /assets/* 与 /favicon 之类
    app.get('/assets/*', async (req, reply) => {
      // 路由是 /assets/*，通配部分不含 'assets/' 这一段
      const rel = (req.params as { '*': string })['*'];
      const file = resolve(WEB_DIST, 'assets', rel);
      // 防目录穿越
      if (!file.startsWith(resolve(WEB_DIST, 'assets'))) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      reply.header('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(await readFile(file));
    });

    app.get('/favicon.ico', async (_req, reply) => {
      const file = join(WEB_DIST, 'favicon.ico');
      if (!existsSync(file)) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.send(await readFile(file));
    });
  }

  // ── 404：API 返回 JSON，其余返回前端页面（SPA 路由）──
  app.setNotFoundHandler(async (req, reply) => {
    const url = req.url;
    if (url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `没找到 ${url}` });
    }
    if (serveWeb && req.method === 'GET' && !url.startsWith('/activities/') && !url.startsWith('/files/')) {
      const html = await readFile(join(WEB_DIST, 'index.html'));
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Cache-Control', 'no-cache');
      return reply.send(html);
    }
    return reply.code(404).send({ error: 'NOT_FOUND', message: `没找到 ${url}` });
  });

  return app;
}
