/**
 * .env 体检器的自动化检查
 *
 * 这个检查器站在部署路径上：它放行 = 部署继续，它拦下 = 上线中止。
 * 逻辑写错了就是上线事故，所以每条规则都要有对应的测试。
 *
 * 特别盯住两类真实踩过的坑：
 *  · 同名变量重复 —— 后者覆盖前者，于是「我改了怎么没生效」
 *  · SMS_DRIVER=tencent 但配置缺项 —— 服务端会拒绝启动，平台整体不可用
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkEnv, explain, parseEnv } from '../deploy/check-env.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** 一份配置齐全的 .env */
const COMPLETE = `
POSTGRES_PASSWORD=pgpass
REDIS_PASSWORD=redispass
JWT_SECRET=0123456789012345678901234567890123
ADMIN_PASSWORD=adminpass
SMS_DRIVER=tencent
SMS_APP_ID=1401230486
SMS_SECRET_ID=AKIDxxxx
SMS_SECRET_KEY=secretkey
SMS_SIGN_NAME=深圳领航梦之城科技
SMS_TEMPLATE_CODE=2761496
SMS_TEMPLATE_PARAM_COUNT=2
SMS_CODE_TTL_MINUTES=5
`;

describe('解析 .env', () => {
  it('读出行首的 KEY=VALUE', () => {
    const { values } = parseEnv('FOO=bar\nBAZ=qux');
    expect(values.get('FOO')).toBe('bar');
    expect(values.get('BAZ')).toBe('qux');
  });

  it('忽略注释与空行', () => {
    const { values } = parseEnv('# 注释\n\nFOO=bar\n#BAZ=qux');
    expect(values.get('FOO')).toBe('bar');
    expect(values.get('BAZ')).toBeUndefined();
  });

  it('认 export 前缀与前导空白', () => {
    const { values } = parseEnv('export FOO=bar\n  BAZ=qux');
    expect(values.get('FOO')).toBe('bar');
    expect(values.get('BAZ')).toBe('qux');
  });

  it('剥掉成对引号，裸值里的 # 不当注释', () => {
    const { values } = parseEnv('A="quoted"\nB=\'single\'\nC=abc#def');
    expect(values.get('A')).toBe('quoted');
    expect(values.get('B')).toBe('single');
    expect(values.get('C')).toBe('abc#def');
  });

  it('值里有等号也不截断', () => {
    const { values } = parseEnv('KEY=a=b=c');
    expect(values.get('KEY')).toBe('a=b=c');
  });
});

describe('必填项检查', () => {
  it('配置齐全时通过', () => {
    expect(checkEnv(COMPLETE)).toEqual([]);
  });

  it('缺 JWT_SECRET 要报出来', () => {
    const problems = checkEnv(COMPLETE.replace(/^JWT_SECRET=.*$/m, ''));
    expect(problems).toContain('MISSING JWT_SECRET');
  });

  it('空值等于缺失', () => {
    const problems = checkEnv(COMPLETE.replace(/^ADMIN_PASSWORD=.*$/m, 'ADMIN_PASSWORD='));
    expect(problems).toContain('MISSING ADMIN_PASSWORD');
  });
});

describe('短信配置检查', () => {
  it('SMS_DRIVER=tencent 时缺短信配置要报出来', () => {
    const problems = checkEnv(COMPLETE.replace(/^SMS_SIGN_NAME=.*$/m, ''));
    expect(problems).toContain('SMS_MISSING SMS_SIGN_NAME');
  });

  it('缺 SMS_SECRET_KEY 也要报出来（最容易漏的一个）', () => {
    const problems = checkEnv(COMPLETE.replace(/^SMS_SECRET_KEY=.*$/m, ''));
    expect(problems).toContain('SMS_MISSING SMS_SECRET_KEY');
  });

  it('SMS_DRIVER=log 时不要求短信配置', () => {
    const logMode = COMPLETE.replace('SMS_DRIVER=tencent', 'SMS_DRIVER=log').replace(
      /^SMS_SECRET_KEY=.*$/m,
      '',
    );
    expect(checkEnv(logMode)).toEqual([]);
  });

  it('没写 SMS_DRIVER 时按 log 处理，不误报', () => {
    const noDriver = COMPLETE.replace(/^SMS_DRIVER=.*$/m, '').replace(/^SMS_SECRET_KEY=.*$/m, '');
    expect(checkEnv(noDriver)).toEqual([]);
  });
});

describe('重复变量检查', () => {
  it('同名变量出现两次要报出来', () => {
    const dup = `${COMPLETE}\nSMS_SIGN_NAME=另一个签名\n`;
    const problems = checkEnv(dup);
    expect(problems.some((p) => p.startsWith('DUPLICATE SMS_SIGN_NAME'))).toBe(true);
  });

  it('重复时后者覆盖前者 —— 这正是「改了没生效」的成因', () => {
    const dup = `${COMPLETE}\nSMS_SIGN_NAME=另一个签名\n`;
    const { values } = parseEnv(dup);
    expect(values.get('SMS_SIGN_NAME')).toBe('另一个签名');
  });

  it('不同的变量重复出现不算问题', () => {
    expect(checkEnv(COMPLETE)).toEqual([]);
  });
});

describe('问题说明', () => {
  it('每条问题都有人话解释', () => {
    const problems = ['MISSING JWT_SECRET', 'SMS_MISSING SMS_APP_ID', 'DUPLICATE SMS_DRIVER x2'];
    const lines = explain(problems);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).toMatch(/^· /);
  });
});

describe('部署脚本确实调用了这个检查器', () => {
  const sh = readFileSync(resolve(ROOT, 'deploy/ci-deploy.sh'), 'utf8');

  it('ci-deploy.sh 里有调用 check-env.mjs', () => {
    expect(sh).toContain('check-env.mjs');
  });

  it('用暂存目录里的版本，不是服务器上的旧版', () => {
    // 部署时服务器上的代码还是上一版；用旧版检查器等于没检查。
    // 而且旧版可能根本不存在（首次部署），脚本会直接失败。
    expect(sh).toContain('$STAGE_DIR/deploy/check-env.mjs');
  });

  it('检查失败要让部署中止（不能只是警告）', () => {
    expect(sh).toMatch(/check-env\.mjs[\s\S]{0,200}?exit 1/);
  });
});
