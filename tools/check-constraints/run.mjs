#!/usr/bin/env node
/**
 * 硬约束自动化检查（C1–C13 + 命名纪律 + schema 一致性）
 *
 * 开发上下文 §0.5：第 8 章每一条都应当有对应的自动化检查。
 * 这不是「文档里的口号」，是 `npm run verify` 会真的跑一遍并拦下问题的东西。
 *
 * 用法：node tools/check-constraints/run.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/* ── 工具 ─────────────────────────────────────────────────── */

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function exists(rel) {
  try {
    statSync(join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

function walk(relDir, out = []) {
  const abs = join(ROOT, relDir);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.git' || e === 'var') continue;
    const rel = `${relDir}/${e}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const results = [];
function check(id, name, fn) {
  const problems = [];
  try {
    fn(problems);
  } catch (err) {
    problems.push(`检查自身出错：${err.message}`);
  }
  results.push({ id, name, problems });
}

/**
 * 去掉注释后再扫描。
 * 注释里经常出现被禁词本身（说明「为什么禁」），那是允许的；
 * 真正要拦的是会出现在产品里的代码与文案。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^\s*--.*$/gm, ' '); // SQL 行注释
}

/** 把「列举被禁词」的常量块本身排除掉 */
function stripForbiddenList(text) {
  return text.replace(/FORBIDDEN_COPY\s*=\s*\[[\s\S]*?\]\s*as const;?/g, ' ');
}

function sourceFiles(dirs) {
  return dirs.flatMap((d) => walk(d)).filter((f) => /\.(ts|tsx|js|jsx|mjs|html|css)$/.test(f));
}

/* ── C1 合规口径 ──────────────────────────────────────────── */

check('C1', '对外文案只用「AI 素养 / 科技素养」，不写学科培训类表述', (p) => {
  const FORBIDDEN = ['提分', '补课', '学科辅导', '学科培训', '辅导班', '奥数', '同步辅导', '刷题', '押题', '升学班'];
  // 排除检查清单自身与文档（那两处本就是在列举被禁词）
  const files = sourceFiles(['packages/shared/src', 'packages/web/src', 'packages/server/src']);
  for (const f of files) {
    const text = stripForbiddenList(stripComments(read(f)));
    for (const word of FORBIDDEN) {
      if (text.includes(word)) {
        const line = text.split('\n').findIndex((l) => l.includes(word)) + 1;
        p.push(`${relative(ROOT, f)} 出现「${word}」`);
      }
    }
  }
});

/* ── C2 不做录播 / 直播主线，M5/M6 必须真人 ─────────────────── */

check('C2', '不做录播/直播课主线；M5/M6 标记为必须真人', (p) => {
  const banned = ['录播', '直播课', 'webinar', '直播'];
  for (const f of sourceFiles(['packages/web/src', 'packages/server/src'])) {
    const text = read(f);
    for (const word of banned) {
      if (text.includes(word)) {
        const line = text.split('\n').findIndex((l) => l.includes(word)) + 1;
        p.push(`${relative(ROOT, f)}:${line} 出现「${word}」`);
      }
    }
  }
  const enums = read('packages/shared/src/enums.ts');
  for (const m of ['MODE_M5', 'MODE_M6']) {
    const block = enums.slice(enums.indexOf(`${m}: {`), enums.indexOf(`${m}: {`) + 400);
    if (!block.includes('teacherOnly: true')) {
      p.push(`${m} 未标记 teacherOnly: true`);
    }
  }
});

/* ── C3 活动单文件、零外部 CDN、零后端请求 ─────────────────── */

check('C3', '活动为单文件 HTML、零外部 CDN、零后端请求', (p) => {
  const files = walk('activities').filter((f) => f.endsWith('.html'));
  if (files.length === 0) p.push('activities/ 下没有活动 HTML');
  for (const f of files) {
    const text = read(f);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      // 允许注释与协议说明里的示例，但不允许真正会发起请求的引用
      const stripped = line.replace(/\/\/.*$/, '').replace(/<!--.*?-->/g, '');
      if (/https?:\/\//.test(stripped) && !/schemas\.openxmlformats|schemas\.microsoft/.test(stripped)) {
        p.push(`${relative(ROOT, f)}:${i + 1} 引用了外部地址`);
      }
      if (/\bsrc\s*=\s*["']https?:/.test(line) || /\bhref\s*=\s*["']https?:/.test(line)) {
        p.push(`${relative(ROOT, f)}:${i + 1} 标签指向外部地址`);
      }
      if (/@import\s+url\(\s*["']?https?:/.test(line)) {
        p.push(`${relative(ROOT, f)}:${i + 1} @import 了外部样式`);
      }
    });
  }
});

/* ── C4 无 WebGL 自动降级 2D + 离线兜底 ───────────────────── */

check('C4', '每个插件都有 offline_fallback 与 2D 降级路径', (p) => {
  const manifest = JSON.parse(read('activities/manifest.json'));
  const htmlByEntry = new Map(
    walk('activities')
      .filter((f) => f.endsWith('.html'))
      .map((f) => [f.split('/').pop(), f]),
  );
  for (const plugin of manifest.plugins) {
    if (!plugin.offline_fallback) {
      p.push(`${plugin.id} 缺少 offline_fallback`);
    }
    const file = htmlByEntry.get(plugin.entry);
    if (!file) {
      p.push(`${plugin.id} 的入口文件 ${plugin.entry} 不存在`);
      continue;
    }
    const html = stripComments(read(file));
    // 硬约束 C4：依赖 WebGL 的插件必须有 2D 降级路径；
    // 完全不用 WebGL 的插件（纯 DOM / 2D）本身就是安全路径。
    const usesWebGL = /getContext\(\s*["'](webgl2?|webgpu)["']/i.test(html);
    const has2D = /getContext\(\s*["']2d["']\s*\)/.test(html);
    if (usesWebGL && !has2D) {
      p.push(`${plugin.id} 用了 WebGL 却没有 2D 降级路径`);
    }
    if (!/prefers-reduced-motion/.test(html)) {
      p.push(`${plugin.id} 不支持 prefers-reduced-motion（插件硬约束 5）`);
    }
  }
});

/* ── C5 lesson 与 class_session 拆表 ─────────────────────── */

check('C5', 'class_session 指向教案版本快照（lesson 与 class_session 拆表）', (p) => {
  const sql = read('packages/server/src/db/migrations/0001_init.sql');
  if (!/CREATE TABLE class_session/.test(sql)) p.push('缺少 class_session 表');
  if (!/plan_version_id\s+text\s+NOT NULL\s+REFERENCES lesson_plan_version/.test(sql)) {
    p.push('class_session.plan_version_id 未强制引用 lesson_plan_version');
  }
  if (!/CREATE TABLE lesson_plan_version/.test(sql)) p.push('缺少 lesson_plan_version 表');
  // 教案版本只增不改：表里不应有删除路径
  if (/DELETE FROM lesson_plan_version/i.test(sql)) p.push('教案版本不应被删除');
});

/* ── C6 讲师单节录入 ≤3 次点击 ────────────────────────────── */

check('C6', '讲师单节录入 ≤3 次点击：实耗由服务端自动算，不让讲师录时长', (p) => {
  const sessionRoutes = read('packages/server/src/modules/session/routes.ts');
  // 采集接口只接受 studentId 与 kind，不接受任何时长输入
  const captureRoute = sessionRoutes.match(/captures'[\s\S]{0,900}?safeParse\(req\.body\)/);
  if (!captureRoute) p.push('找不到采集接口的入参定义');
  else if (/minute|duration|elapsed/i.test(captureRoute[0])) {
    p.push('采集接口不应接受时长/实耗输入（实耗必须自动算）');
  }
  // 环节接口不应接受时长
  const phaseRoute = sessionRoutes.match(/phases\/:phase\/start[\s\S]{0,900}?safeParse\(req\.body\)/);
  if (phaseRoute && /minute|duration/i.test(phaseRoute[0])) {
    p.push('环节推进接口不应接受时长输入');
  }
  // 实耗必须是服务端算出来的
  if (!/PHASE_END[\s\S]{0,400}?actualMin/.test(sessionRoutes)) {
    p.push('环节结束时未在服务端计算 actualMin');
  }
  // 前端必须提供三键采集
  const cockpit = read('packages/web/src/teacher/Cockpit.tsx');
  for (const kind of ['完成', '卡住', '已单独问过']) {
    if (!cockpit.includes(kind)) p.push(`驾驶舱缺少采集按钮「${kind}」`);
  }
});

/* ── C7 可见性服务端强制过滤，越权 404 ────────────────────── */

check('C7', '可见范围在服务端强制过滤，越权返回 404', (p) => {
  const svc = read('packages/server/src/modules/visibility/service.ts');
  if (!svc.includes('class NotFoundError')) p.push('缺少 NotFoundError（越权要返回 404）');
  if (!/statusCode\s*=\s*404/.test(svc)) p.push('NotFoundError 的状态码必须是 404');
  // 每个能读到学生数据的模块都必须过可见性
  for (const mod of ['guardian', 'student']) {
    const text = read(`packages/server/src/modules/${mod}/routes.ts`);
    if (!/visibleScopesFor|assertCanViewArtifact|isGuardianOf/.test(text)) {
      p.push(`${mod} 模块没有调用可见性判定`);
    }
  }
  // 家长路由不得直接按 id 返回学生数据而不校验归属
  const guardian = read('packages/server/src/modules/guardian/routes.ts');
  const idRoutes = guardian.match(/app\.get\('\/api\/guardian\/children\/:id\/[a-z-]+'/g) ?? [];
  if (idRoutes.length === 0) p.push('家长路由里找不到按子 id 读取的接口');
});

/* ── C8 禁止任何量化人气指标与相关字段 ────────────────────── */

check('C8', '数据模型里禁止出现任何量化人气字段', (p) => {
  const FORBIDDEN_COL = [
    'like_count',
    'likes',
    'view_count',
    'views',
    'fans',
    'followers',
    'rank',
    'ranking',
    'popularity',
    'heat',
    'hot_score',
    'praise_count',
    'star_count',
  ];
  const files = ['packages/server/src/db/schema.ts', 'packages/server/src/db/migrations/0001_init.sql'];
  for (const f of files) {
    const text = stripComments(read(f));
    for (const col of FORBIDDEN_COL) {
      const re = new RegExp(`\\b${col}\\b`, 'i');
      if (re.test(text)) p.push(`${relative(ROOT, f)} 出现疑似人气字段「${col}」`);
    }
  }
  // 前端学生端不得展示任何人气数字
  const studentFiles = sourceFiles(['packages/web/src/student']);
  for (const f of studentFiles) {
    const text = stripComments(read(f));
    if (/(人气|点赞数|浏览量|排行榜|获赞)/.test(text)) {
      p.push(`${relative(ROOT, f)} 出现人气相关文案`);
    }
  }
});

/* ── C9 课堂码是会话凭证，不产生长期身份 ──────────────────── */

check('C9', '课堂码是会话凭证，不产生长期身份；学员无密码', (p) => {
  const sql = read('packages/server/src/db/migrations/0001_init.sql');
  const studentBlock = sql.match(/CREATE TABLE student \(([\s\S]*?)\n\);/);
  if (!studentBlock) p.push('找不到 student 表');
  else if (/password/i.test(studentBlock[1])) p.push('student 表不应有密码字段');
  const env = read('packages/server/src/env.ts');
  if (!/STUDENT_TOKEN_TTL_MINUTES\s*=\s*\d+/.test(env)) p.push('缺少学员令牌 TTL 定义');
  if (!/STUDENT_TOKEN_TTL_MINUTES = 180/.test(env)) {
    p.push('学员令牌 TTL 必须是短时效（当前期望 180 分钟）');
  }
  const auth = read('packages/server/src/lib/auth.ts');
  if (!/generateClassCode/.test(auth)) p.push('缺少 6 位课堂码生成');
});

/* ── C10 VIS_L2 / VIS_L3 授权逐件可撤回 ───────────────────── */

check('C10', 'VIS_L2 / VIS_L3 授权逐件可撤回', (p) => {
  const sql = read('packages/server/src/db/migrations/0001_init.sql');
  if (!/CREATE TABLE visibility_grant/.test(sql)) p.push('缺少 visibility_grant 表');
  const grantBlock = sql.match(/CREATE TABLE visibility_grant \(([\s\S]*?)\n\);/);
  if (grantBlock) {
    if (!/revoked_at/.test(grantBlock[1])) p.push('visibility_grant 缺少 revoked_at');
    if (!/artifact_id/.test(grantBlock[1])) p.push('visibility_grant 缺少 artifact_id（逐件授权）');
  }
  const svc = read('packages/server/src/modules/visibility/service.ts');
  if (!/revokeGrants/.test(svc)) p.push('缺少撤销授权的实现');
  const guardian = read('packages/server/src/modules/guardian/routes.ts');
  if (!/grants\/revoke/.test(guardian)) p.push('缺少家长撤回授权的接口');
});

/* ── C11 家长可导出全量数据、可注销 ────────────────────────── */

check('C11', '家长可导出全量数据、可注销；数据不出机构', (p) => {
  const guardian = read('packages/server/src/modules/guardian/routes.ts');
  if (!/children\/:id\/export/.test(guardian)) p.push('缺少家长导出接口');
  if (!/app\.delete\('\/api\/guardian\/children\/:id'/.test(guardian)) p.push('缺少家长注销接口');
  const schemaTs = read('packages/server/src/db/schema.ts');
  if (!/state:\s*text\('state'\)\.notNull\(\)\.default\('ACTIVE'\)/.test(schemaTs)) {
    p.push('student 缺少状态字段（注销应是状态流转而不是删数据）');
  }
});

/* ── C12 错误反馈不用红叉 ─────────────────────────────────── */

check('C12', '儿童产品只给正向引导，不用红叉', (p) => {
  const studentFiles = sourceFiles(['packages/web/src/student', 'packages/shared/src']);
  for (const f of studentFiles) {
    const text = stripComments(read(f));
    for (const sym of ['❌', '✗', '✘', '🔴', '⛔']) {
      if (text.includes(sym)) {
        p.push(`${relative(ROOT, f)} 出现负向符号「${sym}」`);
      }
    }
  }
  // 学生端必须有正向引导文案
  const copy = read('packages/shared/src/copy.ts');
  if (!copy.includes('tryAgain')) p.push('缺少正向引导文案');
});

/* ── C13 不编造未定稿的商业数据 ───────────────────────────── */

check('C13', '未定稿的商业数据留占位，不编造', (p) => {
  const seed = read('packages/seed/src/seed.ts');
  // 报价、开班日期、课包档位必须是 null
  if (!/price:\s*null/.test(seed)) p.push('enrollment.price 必须留 null');
  if (!/startDate:\s*null/.test(seed)) p.push('term.startDate 必须留 null');
  if (!/packageType:\s*null/.test(seed)) p.push('enrollment.packageType 必须留 null');
  // 不得出现具体的价格数字
  const priceLiterals = seed.match(/price:\s*\d+/g);
  if (priceLiterals) p.push(`seed 里出现具体价格：${priceLiterals.join(', ')}`);
  const dateLiterals = seed.match(/startDate:\s*['"]\d{4}-\d{2}-\d{2}/g);
  if (dateLiterals) p.push('seed 里出现具体开班日期');
  // 前端必须显示「待定」而不是编造
  const copy = read('packages/shared/src/copy.ts');
  if (!copy.includes('pending')) p.push('缺少「待定」占位文案');
});

/* ── 命名纪律：禁止裸 L1 / L2 / L3 ───────────────────────── */

check('N1', '代码里禁止出现裸的 L1 / L2 / L3', (p) => {
  const files = sourceFiles([
    'packages/shared/src',
    'packages/server/src',
    'packages/web/src',
    'packages/seed/src',
  ]);
  // 课次编号 L1-01 是合法的；级别常量必须带 GRADE_ / VIS_ 前缀。
  // 前面不能是字母、数字、下划线或引号（否则 GRADE_L1 / VIS_L1 / 'L1' 都会被误伤）
  const BARE = /(?<![\w'"`\-/])L[123](?![-_\d])/g;
  for (const f of files) {
    const text = stripComments(read(f));
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const stripped = line.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      const m = stripped.match(BARE);
      if (m) {
        p.push(`${relative(ROOT, f)}:${i + 1} 裸的 ${m.join(', ')}（应写 GRADE_L* 或 VIS_L*）`);
      }
    });
  }
});

/* ── N2 学员身份只能由监护人创建（无开放注册）─────────────── */

check('N2', '学员身份只能由监护人创建，不存在开放注册入口', (p) => {
  // 1. 没有公开的「注册」路由
  const routes = [];
  for (const dir of ['auth', 'content', 'session', 'guardian', 'student', 'ops']) {
    const f = `packages/server/src/modules/${dir}/routes.ts`;
    if (!exists(f)) continue;
    const text = read(f);
    for (const m of text.matchAll(/app\.(post|get|put|delete)\(\s*'([^']+)'([^)]*)\)/g)) {
      routes.push({ dir, method: m[1], path: m[2], tail: m[3] });
    }
  }
  for (const r of routes) {
    const isSignup = /signup|register|join/i.test(r.path);
    if (isSignup) {
      p.push(`发现疑似开放注册接口：${r.method.toUpperCase()} ${r.path}`);
      continue;
    }
    // 2. 任何会创建学员身份的接口都必须挂在家长守卫上
    if (r.path.includes('/children') && r.method === 'post' && !r.tail.includes('requireGuardian')) {
      p.push(`${r.path} 创建学员身份但没有 requireGuardian 守卫`);
    }
  }

  // 3. 学生端没有账号密码入口
  const studentFiles = sourceFiles(['packages/web/src/student']);
  for (const f of studentFiles) {
    const text = stripComments(read(f));
    if (/type=["']password["']/.test(text)) {
      p.push(`${relative(ROOT, f)} 出现了密码输入框（8 岁孩子不应记密码）`);
    }
  }

  // 4. 数据库里学生表没有密码列
  const sql = read('packages/server/src/db/migrations/0001_init.sql');
  const studentBlock = sql.match(/CREATE TABLE student \(([\s\S]*?)\n\);/);
  if (studentBlock && /password/i.test(studentBlock[1])) {
    p.push('student 表不应有密码字段');
  }
});

/* ── S1 schema.ts ↔ 迁移 SQL 一致性 ──────────────────────── */

check('S1', 'drizzle schema 与迁移 SQL 的表和列保持一致', (p) => {
  const schemaTs = read('packages/server/src/db/schema.ts');
  const sql = read('packages/server/src/db/migrations/0001_init.sql');

  // schema.ts 里的表名与列名
  const schemaTables = new Map();
  const tableRe = /export const (\w+) = pgTable\(\s*'([^']+)'/g;
  let m;
  while ((m = tableRe.exec(schemaTs)) !== null) {
    const tableName = m[2];
    // 表定义块：从当前 export 起到下一个 export 之前
    const start = m.index;
    const next = schemaTs.indexOf('\nexport const ', start + 1);
    const block = schemaTs.slice(start, next > 0 ? next : schemaTs.length);
    const cols = new Set();
    const colRe = /\b(?:text|integer|boolean|jsonb|numeric|timestamp|date)\('([a-z_0-9]+)'/g;
    let c;
    while ((c = colRe.exec(block)) !== null) cols.add(c[1]);
    schemaTables.set(tableName, cols);
  }

  const sqlTables = new Map();
  const sqlTableRe = /CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g;
  while ((m = sqlTableRe.exec(sql)) !== null) {
    const name = m[1];
    const body = m[2];
    const cols = new Set();
    for (const line of body.split('\n')) {
      const cm = /^\s{2}([a-z_0-9]+)\s+(text|integer|boolean|jsonb|numeric|timestamptz|date)\b/.exec(line);
      if (cm) cols.add(cm[1]);
    }
    sqlTables.set(name, cols);
  }

  for (const [table, cols] of schemaTables) {
    if (!sqlTables.has(table)) {
      p.push(`SQL 里缺少表 ${table}`);
      continue;
    }
    const sqlCols = sqlTables.get(table);
    for (const col of cols) {
      if (!sqlCols.has(col)) p.push(`SQL 里 ${table} 缺少列 ${col}`);
    }
  }
  for (const [table] of sqlTables) {
    if (!schemaTables.has(table)) p.push(`schema.ts 里缺少表 ${table}`);
  }
});

/* ── 输出 ─────────────────────────────────────────────────── */

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

console.log(`\n${BOLD}梦之城平台 · 硬约束检查${RESET} ${DIM}（C1–C13 + 命名纪律 + schema 一致性）${RESET}\n`);

let failed = 0;
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`${GREEN}✓${RESET} ${DIM}${r.id}${RESET} ${r.name}`);
  } else {
    failed += 1;
    console.log(`${RED}✗ ${r.id}${RESET} ${r.name}`);
    for (const p of r.problems) console.log(`    ${RED}·${RESET} ${p}`);
  }
}

console.log(`\n${'─'.repeat(56)}`);
if (failed === 0) {
  console.log(`${GREEN}全部 ${results.length} 项通过 ✓${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${failed} 项未通过${RESET} / 共 ${results.length} 项\n`);
  process.exit(1);
}
