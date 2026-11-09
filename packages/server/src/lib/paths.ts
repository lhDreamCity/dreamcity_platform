import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../env.js';

/**
 * PGlite 用非递归 mkdir 建数据目录，父目录不存在会 ENOENT。
 * 所以在构造 client 之前把目录（含父级）先建出来。
 */
export function ensureDirSync(path: string): string {
  const target = resolve(env.root, path);
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(target, { recursive: true });
  return target;
}
