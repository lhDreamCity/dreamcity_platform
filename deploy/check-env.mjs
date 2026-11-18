#!/usr/bin/env node
/**
 * .env 配置体检 —— 部署前的最后一道闸
 *
 * 为什么要有这个：
 * 服务端在 `SMS_DRIVER=tencent` 但配置缺项时会**拒绝启动**（缺项 = 短信一条都
 * 发不出去，服务起来也是坏的）。如果这种情况走到部署之后才发现，容器起不来，
 * 平台整体就不可用了 —— 讲师端也进不去。
 *
 * 所以在部署前先查一遍，缺什么当场说清楚。
 *
 * 两种检查：
 *  1. **必填项缺失** —— 平台起不来的那种
 *  2. **同名变量重复** —— 后出现的会覆盖先出现的，于是「我改了怎么没生效」
 *     （最常见的元凶：早先追加过一份，后来又追加一份新的）
 *
 * 用法：
 *   node deploy/check-env.mjs <.env 路径>
 *   退出码 0 = 通过；1 = 有问题（问题逐条打印到 stderr）
 */

import { readFileSync } from 'node:fs';

/** 不管配不配都需要的 */
const REQUIRED = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'ADMIN_PASSWORD'];

/** 只有 SMS_DRIVER=tencent 时才需要的 */
const SMS_REQUIRED = [
  'SMS_APP_ID',
  'SMS_SECRET_ID',
  'SMS_SECRET_KEY',
  'SMS_SIGN_NAME',
  'SMS_TEMPLATE_CODE',
];

/** 这些不该重复出现 */
const UNIQUE = [
  'SMS_DRIVER',
  'SMS_APP_ID',
  'SMS_SECRET_ID',
  'SMS_SECRET_KEY',
  'SMS_SIGN_NAME',
  'SMS_TEMPLATE_CODE',
  'SMS_TEMPLATE_PARAM_COUNT',
  'SMS_CODE_TTL_MINUTES',
];

/**
 * 解析 .env。
 *
 * 只认行首的 `KEY=VALUE`（允许前导空白与 export 前缀）——
 * 这跟 shell 与 docker compose 的读法一致，别自己发明规则。
 * 值里的 `#` 不当注释（`SECRET_KEY=abc#def` 里 # 是密钥的一部分）。
 */
export function parseEnv(text) {
  const values = new Map();
  const counts = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s]*export[\s]+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // 只去掉成对引号里的引号，不动裸值
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { values, counts };
}

/**
 * 检查 .env 内容，返回问题列表（空数组 = 通过）。
 *
 * 拆成纯函数是为了能测 —— 部署脚本跑在服务器上，出错就是上线事故，
 * 逻辑必须能在本机先验一遍。
 */
export function checkEnv(text) {
  const problems = [];
  const { values, counts } = parseEnv(text);

  for (const key of REQUIRED) {
    const v = values.get(key);
    if (v === undefined || v === '') problems.push(`MISSING ${key}`);
  }

  if (values.get('SMS_DRIVER') === 'tencent') {
    for (const key of SMS_REQUIRED) {
      const v = values.get(key);
      if (v === undefined || v === '') problems.push(`SMS_MISSING ${key}`);
    }
  }

  for (const key of UNIQUE) {
    const n = counts.get(key) ?? 0;
    if (n > 1) problems.push(`DUPLICATE ${key} x${n}`);
  }

  return problems;
}

/** 把问题列表翻译成人话 */
export function explain(problems) {
  const lines = [];
  for (const p of problems) {
    const [kind, ...rest] = p.split(' ');
    const key = rest.join(' ');
    if (kind === 'MISSING') {
      lines.push(`· 缺少 ${key} —— 平台起不来`);
    } else if (kind === 'SMS_MISSING') {
      lines.push(`· 缺少 ${key} —— SMS_DRIVER=tencent 时服务端会拒绝启动`);
    } else if (kind === 'DUPLICATE') {
      lines.push(`· ${key} 出现了多次 —— 后面的会覆盖前面的，会出现「改了没生效」，请清理成只留一行`);
    }
  }
  return lines;
}

/* ── 命令行入口 ────────────────────────────────────────────── */
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('用法：node deploy/check-env.mjs <.env 路径>');
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`✗ 读不到 ${file}：${err.message}`);
    process.exit(1);
  }
  const problems = checkEnv(text);
  if (problems.length > 0) {
    console.error(`✗ .env 配置检查未通过（${file}）：`);
    for (const line of explain(problems)) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`✓ .env 配置检查通过（${file}）`);
}
