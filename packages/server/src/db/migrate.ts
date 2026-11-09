/**
 * 迁移执行器
 *
 * 迁移文件是手写的 SQL（与 schema.ts 的列名一致性由自动化检查保证），
 * 按文件名顺序执行一次，记录在 __migrations 表里。
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../env.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, './migrations');

/**
 * 按分号切分 SQL 语句，正确跳过字符串字面量与行注释。
 * 本项目迁移里不含 dollar-quoted 块，因此不需要处理 $tag$。
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inString = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        buf += ch;
      }
      continue;
    }
    if (!inString && ch === '-' && next === '-') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      // 连续两个单引号是转义
      if (inString && next === "'") {
        buf += ch + next;
        i += 1;
        continue;
      }
      inString = !inString;
      buf += ch;
      continue;
    }
    if (!inString && ch === ';') {
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export interface MigrationRunner {
  exec(sql: string): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

async function pgliteRunner(): Promise<MigrationRunner> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { ensureDirSync } = await import('../lib/paths.js');
  const client = new PGlite(ensureDirSync(env.db.pgliteDataDir));
  await client.waitReady;
  return {
    async exec(sql) {
      await client.exec(sql);
    },
    async query(sql) {
      const res = await client.query(sql);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
}

async function pgRunner(): Promise<MigrationRunner> {
  const { Pool } = await import('pg');
  if (!env.db.url) throw new Error('DATABASE_DRIVER=pg 时必须设置 DATABASE_URL');
  const pool = new Pool({ connectionString: env.db.url, max: 1 });
  return {
    async exec(sql) {
      await pool.query(sql);
    },
    async query(sql) {
      const res = await pool.query(sql);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
}

export async function createRunner(): Promise<MigrationRunner> {
  return env.db.driver === 'pg' ? pgRunner() : pgliteRunner();
}

export async function runMigrations(): Promise<string[]> {
  const runner = await createRunner();

  await runner.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await runner.query('SELECT name FROM __migrations')).rows.map((r) => r.name as string),
  );

  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await runner.exec(stmt);
    }
    await runner.exec(`INSERT INTO __migrations (name) VALUES ('${file.replace(/'/g, "''")}')`);
    done.push(file);
  }
  return done;
}
