/**
 * 数据库驱动 —— 开发用 PGlite（WASM Postgres，零安装），生产用真 PostgreSQL。
 * 同一套 schema、同一套 SQL、同一套 drizzle 查询，只换连接方式。
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { env } from '../env.js';
import { ensureDirSync } from '../lib/paths.js';
import * as schema from './schema.js';

/**
 * 数据库类型。
 *
 * 两种驱动产出的是同一套 drizzle API，但联合类型会让方法调用（returning / where 等）
 * 解析到错误的重载上，所以统一按 PGlite 的实例类型收口，node-postgres 那边做一次安全转换。
 */
export type Db = ReturnType<typeof createPglite>;

function createPglite() {
  const client = new PGlite(ensureDirSync(env.db.pgliteDataDir));
  return drizzlePglite(client, { schema });
}

function createNodePg() {
  if (!env.db.url) {
    throw new Error('DATABASE_DRIVER=pg 时必须设置 DATABASE_URL');
  }
  const pool = new Pool({ connectionString: env.db.url, max: 10 });
  return drizzleNodePg(pool, { schema }) as unknown as Db;
}

let instance: Db | null = null;

export function getDb(): Db {
  if (!instance) {
    instance = env.db.driver === 'pg' ? createNodePg() : createPglite();
  }
  return instance;
}

/** 迁移用：拿到底层 client 以便执行整段 SQL */
export async function getMigrationClient(): Promise<
  { exec: (sql: string) => Promise<void> } | { query: (sql: string) => Promise<unknown> }
> {
  if (env.db.driver === 'pg') {
    const pool = new Pool({ connectionString: env.db.url, max: 1 });
    return {
      async query(sql: string) {
        await pool.query(sql);
      },
    };
  }
  const dataDir = resolve(env.root, env.db.pgliteDataDir);
  const client = new PGlite(ensureDirSync(env.db.pgliteDataDir));
  await client.waitReady;
  return {
    async exec(sql: string) {
      await client.exec(sql);
    },
  };
}

export { schema };
