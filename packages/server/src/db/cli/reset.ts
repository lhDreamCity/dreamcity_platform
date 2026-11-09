/**
 * 重置开发数据库：删掉数据目录，下次 migrate 会从零建库。
 * ⚠️ 只用于开发，生产环境请勿执行。
 */

import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../../env.js';

if (env.isProd) {
  console.error('生产环境禁止执行 db:reset。');
  process.exit(1);
}

const dir = resolve(env.root, env.db.pgliteDataDir);
await rm(dir, { recursive: true, force: true });
console.log(`已清空 ${dir}，下次 npm run db:migrate 会重新建库。`);
process.exit(0);
