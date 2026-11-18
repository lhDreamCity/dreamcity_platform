#!/usr/bin/env node
/**
 * 看 CI / Deploy 跑到哪一步了
 *
 * 仓库改成 private 之后，GitHub 的 API 需要认证才能读 —— 匿名调用会 404。
 * 所以这个脚本带 token：优先读环境变量 GH_TOKEN / GITHUB_TOKEN，
 * 没有就退回到 `gh auth token`（gh 登录过的话它自己知道）。
 *
 * 用法：
 *   node tools/ci-status.mjs            # 最近几次运行
 *   node tools/ci-status.mjs --jobs     # 附带每个 job 的每一步结论
 *
 * 只读状态，不改任何东西。
 */

import { execFileSync } from 'node:child_process';

const REPO = 'lhDreamCity/dreamcity_platform';
const API = `https://api.github.com/repos/${REPO}`;

/** 拿一个能读私有仓库的 token */
function getToken() {
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  // 退回到 gh CLI 的登录凭据
  try {
    const out = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    const t = out.trim();
    if (t) return t;
  } catch {
    /* gh 不在或没登录 —— 下面统一提示 */
  }
  return null;
}

const token = getToken();
if (!token) {
  console.error('没有可用的 GitHub 凭据。仓库现在是 private，读 Actions 需要认证。');
  console.error('');
  console.error('二选一：');
  console.error('  A. 登录 gh（一次性，会给设备码，浏览器里确认即可）');
  console.error('     gh auth login --hostname github.com --git-protocol ssh --web');
  console.error('  B. 设一个环境变量（PAT 需要 repo 权限）');
  console.error('     $env:GH_TOKEN = "<你的 token>"');
  console.error('');
  console.error('设好后重跑这个脚本。');
  process.exit(2);
}

const headers = {
  'User-Agent': 'dreamcity-ci-status',
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
};

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} —— ${path}`);
  }
  return res.json();
}

const wantsJobs = process.argv.includes('--jobs');

try {
  const { workflow_runs: runs } = await get(
    '/actions/runs?per_page=6',
  );

  console.log(`\n最近运行（${REPO}）\n`);
  for (const r of runs) {
    const sha = r.head_sha.slice(0, 7);
    console.log(`  ${r.name.padEnd(8)} ${String(r.status).padEnd(10)} ${String(r.conclusion ?? '-').padEnd(10)} ${sha}`);
  }

  if (!wantsJobs) {
    console.log('\n加 --jobs 看每个步骤的结论：node tools/ci-status.mjs --jobs\n');
    process.exit(0);
  }

  for (const r of runs) {
    if (r.name !== 'CI' && r.name !== 'Deploy') continue;
    const { jobs } = await get(`/actions/runs/${r.id}/jobs`);
    console.log(`\n${r.name} (${r.head_sha.slice(0, 7)}) => ${r.conclusion ?? r.status}`);
    for (const j of jobs) {
      console.log(`  ${j.name} => ${j.conclusion ?? j.status}`);
      for (const s of j.steps ?? []) {
        console.log(`     ${s.name} => ${s.conclusion ?? s.status}`);
      }
    }
  }
  console.log('');
} catch (err) {
  console.error(`读 Actions 状态失败：${err.message}`);
  console.error('如果报 404，多半是 token 权限不够（PAT 需要 repo 权限）或仓库名不对。');
  process.exit(1);
}
