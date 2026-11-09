/**
 * 环境配置 —— 全部有本地兜底，不填也能跑起来（开发上下文 §7.2：外部依赖全部可降级）
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');

for (const candidate of [resolve(root, '.env'), resolve(root, 'packages/server/.env')]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* 没有 .env 就用默认值 */
    }
  }
}

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const env = {
  root,
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  serverPort: num('SERVER_PORT', 8787),
  webPort: num('WEB_PORT', 5173),

  db: {
    driver: str('DATABASE_DRIVER', 'pglite') as 'pglite' | 'pg',
    url: str('DATABASE_URL', ''),
    pgliteDataDir: str('PGLITE_DATA_DIR', './var/pgdata'),
  },

  redisUrl: str('REDIS_URL', ''),

  /**
   * 允许的跨域来源。
   * 生产环境必须显式列出域名；开发环境留空表示允许全部。
   * ⚠️ 未配置就上云 = 任何站点都能拿用户的令牌调接口。
   */
  corsOrigins: str('CORS_ORIGINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** 是否由后端直接托管打包好的前端（生产用；开发用 Vite） */
  serveWeb: str('SERVE_WEB', 'auto'),

  token: {
    secret: str('JWT_SECRET', ''),
    ttlMinutes: num('TOKEN_TTL_MINUTES', 720),
  },

  sms: {
    driver: str('SMS_DRIVER', 'log') as 'log' | 'tencent',
    appId: str('SMS_APP_ID', ''),
    secretId: str('SMS_SECRET_ID', ''),
    signName: str('SMS_SIGN_NAME', ''),
    templateCode: str('SMS_TEMPLATE_CODE', ''),
    /** 同一手机号两次发送的最小间隔（秒） */
    rateLimitSeconds: num('SMS_RATE_LIMIT_SECONDS', 60),
  },

  objectStore: {
    driver: str('OBJECT_STORE_DRIVER', 'local') as 'local' | 's3',
    dir: str('OBJECT_STORE_DIR', './var/objects'),
    endpoint: str('S3_ENDPOINT', ''),
    region: str('S3_REGION', ''),
    bucket: str('S3_BUCKET', ''),
    accessKeyId: str('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    publicBaseUrl: str('S3_PUBLIC_BASE_URL', ''),
  },
} as const;

/**
 * 课堂码 TTL：2 小时，且下课时立即失效（设计方案 §7.3）
 */
export const CLASS_CODE_TTL_SECONDS = 2 * 60 * 60;

/**
 * 学生课堂令牌 TTL：短时效会话凭证，不是长期身份（C9）
 */
export const STUDENT_TOKEN_TTL_MINUTES = 180;

/**
 * 上云前的启动自检 —— 生产环境缺关键配置就别起来了，
 * 免得带着默认密钥上线。
 *
 * 分两类：
 *   硬性 —— 缺了就直接拒绝启动（安全相关）
 *   提示 —— 首次上线可以先不配，但会明确警告（外部服务相关）
 */
export function assertProductionConfig(): void {
  if (!env.isProd) return;
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (!env.token.secret) fatal.push('JWT_SECRET 未设置');
  else if (env.token.secret.length < 32) fatal.push('JWT_SECRET 太短（至少 32 位）');

  if (env.db.driver !== 'pg') fatal.push('生产环境 DATABASE_DRIVER 必须是 pg（不能用 PGlite）');
  else if (!env.db.url) fatal.push('生产环境必须设置 DATABASE_URL');

  if (!env.redisUrl) fatal.push('生产环境必须设置 REDIS_URL（课堂码与限流需要共享缓存）');
  if (env.corsOrigins.length === 0) {
    fatal.push('生产环境必须设置 CORS_ORIGINS（否则任何站点都能调接口）');
  }

  if (env.sms.driver !== 'tencent') {
    warnings.push(
      'SMS_DRIVER 不是 tencent —— 家长登录验证码只会打到服务端日志里，真实家长用不了。' +
        '上线前请接入腾讯云短信。',
    );
  }
  if (env.objectStore.driver !== 's3') {
    warnings.push(
      'OBJECT_STORE_DRIVER 不是 s3 —— 作品与课件会存在容器本地卷里。' +
        '单机部署可以先用着，多实例或换机器前请接入腾讯云 COS。',
    );
  }

  if (fatal.length > 0) {
    throw new Error(
      `生产环境配置不完整，拒绝启动：\n  · ${fatal.join('\n  · ')}\n` +
        '详见 docs/部署.md 的上线检查清单。',
    );
  }
  if (warnings.length > 0) {
    console.warn('\n⚠ 生产环境尚未完全就绪：');
    for (const w of warnings) console.warn(`  · ${w}`);
    console.warn('');
  }
}
