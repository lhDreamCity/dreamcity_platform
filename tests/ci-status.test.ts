/**
 * CI 状态查询脚本的自动化检查
 *
 * 仓库改成 private 之后，读 Actions 状态必须带 token —— 这个脚本是唯一的入口。
 * 它坏了 = 上线时看不到 Deploy 卡在哪一步，只能干等。
 *
 * 所以重点盯两件事：
 *  1. 没凭据时**要说清楚怎么办**（而不是抛一个看不懂的 401）
 *  2. 凭据来源要可靠：环境变量优先，退回 gh CLI
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = readFileSync(resolve(ROOT, 'tools/ci-status.mjs'), 'utf8');

describe('CI 状态脚本', () => {
  it('仓库是 private 的，所以必须带 Authorization 头', () => {
    expect(SRC).toContain('Authorization');
    expect(SRC).toContain('Bearer');
  });

  it('凭据来源：环境变量优先，退回 gh CLI', () => {
    expect(SRC).toContain('GH_TOKEN');
    expect(SRC).toContain('GITHUB_TOKEN');
    expect(SRC).toContain("gh', ['auth', 'token']");
  });

  it('没凭据时给出可操作的提示，而不是干巴巴报错', () => {
    expect(SRC).toContain('gh auth login');
    expect(SRC).toContain('GH_TOKEN');
    // 提示要说出「仓库现在是 private」这个原因
    expect(SRC).toContain('private');
  });

  it('支持 --jobs 看每个步骤的结论', () => {
    expect(SRC).toContain('--jobs');
  });

  it('只读状态，不做任何写操作', () => {
    // 不该出现 POST / PATCH / PUT / DELETE
    expect(SRC).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
  });
});

describe('文档不再依赖匿名 API', () => {
  const docs = ['docs/上线操作清单.md', 'docs/GitHub全流程.md'];

  it('两份文档都不再用匿名 API 读 Actions', () => {
    for (const d of docs) {
      const text = readFileSync(resolve(ROOT, d), 'utf8');
      // 旧的匿名写法：Invoke-RestMethod 打 api.github.com 且没有 Authorization
      const anonymous = text.match(/Invoke-RestMethod "https:\/\/api\.github\.com[^"]*"/g) ?? [];
      for (const line of anonymous) {
        expect(line).not.toContain('actions/runs');
      }
    }
  });

  it('两份文档都指向 ci-status.mjs', () => {
    for (const d of docs) {
      const text = readFileSync(resolve(ROOT, d), 'utf8');
      expect(text).toContain('ci-status.mjs');
    }
  });
});
