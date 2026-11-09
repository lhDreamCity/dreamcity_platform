#!/usr/bin/env node
/**
 * 端到端冒烟测试 —— 对应《设计方案》§9.2 的 V1 验收指标
 *
 * 跑法：先启动后端（npm run dev:server），再执行 node tools/smoke-test.mjs
 *
 * 覆盖：
 *  1. 健康检查 / 级别 / 48 节课 / 插件
 *  2. 讲师登录 → 建课 → 开课拿课堂码
 *  3. 学生用课堂码进入 → 选头像 → 拿到课堂令牌
 *  4. 驾驶舱：环节实耗自动累计、三键采集落库
 *  5. 插件结果回传 → 产出落库 → 展位生成
 *  6. 结课 → 课堂码立即失效
 *  7. 家长登录 → 看到作品墙 → 授权 VIS_L1
 *  8. 可见性越权 → 404（C7）
 *  9. 导出接口可用（C11）
 */

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 失败时把响应体带上，省得回头再查一遍 */
function detail(res) {
  const b = res?.body;
  if (b === null || b === undefined) return '';
  const s = typeof b === 'string' ? b : JSON.stringify(b);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function main() {
  console.log(`\n梦之城平台 · 端到端冒烟测试 → ${BASE}\n`);

  // ── 0. 先登录讲师（课程内容是受保护资源）─────────────────
  const login = await api('/api/auth/staff/login', {
    method: 'POST',
    body: { email: 'teacher@dreamcity.cn', password: 'dreamcity-demo' },
  });
  if (login.status !== 200) {
    console.error(`✗ 讲师登录失败（${login.status}）：${JSON.stringify(login.body)}`);
    console.error('  生产环境请先用 create-teacher 建账号；本地演示用 teacher@dreamcity.cn / dreamcity-demo');
    process.exit(1);
  }
  const staffToken = login.body?.token;

  // ── 1. 基础 ────────────────────────────────────────────
  console.log('[1] 基础接口');
  const health = await api('/api/health');
  ok('健康检查返回 ok', health.status === 200 && health.body?.ok === true);

  const levels = await api('/api/levels', { token: staffToken });
  ok('三个课程级别', levels.status === 200 && levels.body?.length === 3);
  ok(
    '级别 id 使用 GRADE_ 前缀（命名陷阱）',
    (levels.body ?? []).every((l) => /^GRADE_L[123]$/.test(l.id)),
    JSON.stringify((levels.body ?? []).map((l) => l.id)),
  );

  const lessons = await api('/api/lessons', { token: staffToken });
  ok('48 节课入库', lessons.status === 200 && lessons.body?.length === 48, `实际 ${lessons.body?.length}`);

  const lesson1 = await api('/api/lessons/L1-01', { token: staffToken });
  ok('课次细案十字段齐全', lesson1.status === 200 && !!lesson1.body?.plan?.teachingGoal && !!lesson1.body?.plan?.segments);
  ok('细案五环节', (lesson1.body?.plan?.segments ?? []).length === 5);

  const plugins = await api('/api/plugins', { token: staffToken });
  ok('3 个插件注册', plugins.status === 200 && plugins.body?.length === 3);

  // ── 1b. 课程内容必须受保护 ──────────────────────────────
  const anonLessons = await api('/api/lessons');
  ok('未登录读不到课次内容（封闭域）', anonLessons.status === 401, `HTTP ${anonLessons.status}`);
  const anonPlugin = await api('/api/plugins');
  ok('未登录读不到插件清单', anonPlugin.status === 401, `HTTP ${anonPlugin.status}`);

  // ── 2. 讲师 ────────────────────────────────────────────
  console.log('\n[2] 讲师：登录 → 建课 → 开课');
  ok('讲师登录成功', login.status === 200 && !!staffToken);

  const session = await api('/api/sessions', {
    method: 'POST',
    token: staffToken,
    body: { lessonId: 'L1-01', roomName: '冒烟测试教室', participantCount: 2 },
  });
  ok('建课成功', session.status === 201 && !!session.body?.id, JSON.stringify(session.body));
  const sessionId = session.body?.id;

  const tooSmall = await api('/api/sessions', {
    method: 'POST',
    token: staffToken,
    body: { lessonId: 'L1-01', roomName: 'x', participantCount: 1 },
  });
  ok('班型下限 ≥2 生效（拒绝 1 人）', tooSmall.status === 400);

  const opened = await api(`/api/sessions/${sessionId}/open`, { method: 'POST', token: staffToken });
  ok('开课拿到 6 位课堂码', opened.status === 200 && /^\d{6}$/.test(opened.body?.classCode ?? ''), detail(opened));
  const classCode = opened.body?.classCode;

  // ── 3. 学生 ────────────────────────────────────────────
  console.log('\n[3] 学生：课堂码进入 → 选头像');
  const enter = await api('/api/auth/student/enter', { method: 'POST', body: { classCode } });
  ok('课堂码可进入并返回本班名单', enter.status === 200 && (enter.body?.students ?? []).length === 2);

  const pick = await api('/api/auth/student/pick', {
    method: 'POST',
    body: { classCode, studentId: 'stu_demo_xiaoyu' },
  });
  ok('选头像换到课堂令牌', pick.status === 200 && !!pick.body?.token);
  const studentToken = pick.body?.token;

  const studentSession = await api('/api/student/session', { token: studentToken });
  ok('学生看到当堂信息', studentSession.status === 200 && !!studentSession.body?.lessonTitle);

  // ── 4. 驾驶舱 ──────────────────────────────────────────
  console.log('\n[4] 驾驶舱：实耗自动累计 + 三键采集');
  const putActs = await api(`/api/sessions/${sessionId}/activities`, {
    method: 'PUT',
    token: staffToken,
    body: {
      activities: [
        { phase: '导入', modeCard: 'MODE_M3', title: 'AI 找一找', durationMin: 10, activityKind: 'VOTE' },
        { phase: '讲解', modeCard: 'MODE_M1', title: '图片卡二分', durationMin: 20, activityKind: 'LESSON_PDF' },
        { phase: '实操', modeCard: 'MODE_M2', title: '柠檬水摊大作战', durationMin: 25, activityKind: 'PLUGIN', pluginId: 'lemon-stand' },
        { phase: '实操', modeCard: 'MODE_M5', title: '讲师巡场点拨', durationMin: 15, activityKind: 'BREAK' },
        { phase: '展示', modeCard: 'MODE_M6', title: '每人分享一个发现', durationMin: 15, activityKind: 'SUBMIT' },
        { phase: '收尾', modeCard: 'MODE_M1', title: '三句话收束', durationMin: 5, activityKind: 'BREAK' },
      ],
    },
  });
  ok('编排保存成功', putActs.status === 200 && putActs.body?.count === 6, detail(putActs));

  const cockpit0 = await api(`/api/sessions/${sessionId}/cockpit`, { token: staffToken });
  ok('驾驶舱返回五环节时间轴', cockpit0.status === 200 && (cockpit0.body?.phases ?? []).length === 5);
  ok('五环节都有计划时长', (cockpit0.body?.phases ?? []).every((p) => p.plannedMin > 0));

  await api(`/api/sessions/${sessionId}/phases/导入/start`, { method: 'POST', token: staffToken });
  const cockpit1 = await api(`/api/sessions/${sessionId}/cockpit`, { token: staffToken });
  const importPhase = (cockpit1.body?.phases ?? []).find((p) => p.phase === '导入');
  ok(
    '进行中的环节自动累计实耗（讲师不录入）',
    (importPhase?.actualSec ?? 0) >= 0 && importPhase?.startedAt !== null,
    `actualSec=${importPhase?.actualSec}`,
  );
  ok('进行中环节被标记', importPhase?.isCurrent === true);

  const capture = await api(`/api/sessions/${sessionId}/captures`, {
    method: 'POST',
    token: staffToken,
    body: { studentId: 'stu_demo_xiaoyu', kind: '已单独问过' },
  });
  ok('三键采集落库', capture.status === 200 && capture.body?.ok === true);
  const cockpit2 = await api(`/api/sessions/${sessionId}/cockpit`, { token: staffToken });
  const xiaoyu = (cockpit2.body?.participants ?? []).find((p) => p.studentId === 'stu_demo_xiaoyu');
  ok('名单上能看到「已单独问过」次数', (xiaoyu?.askedCount ?? 0) >= 1);

  // ── 5. 插件回传 ────────────────────────────────────────
  console.log('\n[5] 活动结果回传 → 产出落库');
  const acts = (cockpit2.body?.activities ?? []).find((a) => a.activityKind === 'PLUGIN');
  const result = await api(`/api/sessions/${sessionId}/results`, {
    method: 'POST',
    token: staffToken,
    body: {
      activityId: acts?.id,
      studentId: 'stu_demo_xiaoyu',
      payload: { score: 86, final_price: 6, profit: 42, rounds: 5, badges: ['定价小能手'] },
      visibility: 'VIS_L0',
    },
  });
  ok('插件结果回传成功并生成产出', result.status === 200 && !!result.body?.artifactId, detail(result));

  const badResult = await api(`/api/sessions/${sessionId}/results`, {
    method: 'POST',
    token: staffToken,
    body: { activityId: acts?.id, studentId: 'stu_demo_xiaoyu', payload: { score: 'not-a-number' } },
  });
  ok('不符合 result_schema 的结果被拒', badResult.status === 400);

  const foreign = await api(`/api/sessions/${sessionId}/results`, {
    method: 'POST',
    token: staffToken,
    body: { activityId: 'sa_not_in_session', payload: { score: 1 } },
  });
  ok('不属于本次课的 activityId 被拒', foreign.status === 404);

  // ── 6. 结课 ────────────────────────────────────────────
  console.log('\n[6] 结课 → 课堂码立即失效');
  const closed = await api(`/api/sessions/${sessionId}/close`, { method: 'POST', token: staffToken });
  ok('结课成功并生成摘要草稿', closed.status === 200 && !!closed.body?.draft, detail(closed));
  const reenter = await api('/api/auth/student/enter', { method: 'POST', body: { classCode } });
  ok('课堂码下课后立即失效', reenter.status === 404);

  // ── 7. 家长 ────────────────────────────────────────────
  console.log('\n[7] 家长端');
  // 验证码：可能撞上 60 秒限流，等一下重发即可
  let sendCode = await api('/api/auth/guardian/send-code', {
    method: 'POST',
    body: { phone: '13800000001' },
  });
  if (sendCode.status === 429) {
    console.log('    （撞上验证码限流，等待后重发…）');
    await new Promise((r) => setTimeout(r, 62_000));
    sendCode = await api('/api/auth/guardian/send-code', {
      method: 'POST',
      body: { phone: '13800000001' },
    });
  }
  ok('验证码发送成功', sendCode.status === 200, detail(sendCode));

  // 开发模式（SMS_DRIVER=log）验证码固定，可用 SMS_TEST_CODE 覆盖
  const devCode = process.env.SMS_TEST_CODE ?? '00000';
  const glogin = await api('/api/auth/guardian/login', {
    method: 'POST',
    body: { phone: '13800000001', code: devCode },
  });
  ok('家长登录（开发模式需 SMS_TEST_CODE 与控制台一致）', glogin.status === 200 && !!glogin.body?.token);
  const guardianToken = glogin.body?.token;

  if (guardianToken) {
    const kids = await api('/api/guardian/children', { token: guardianToken });
    ok('家长看到自己的孩子', kids.status === 200 && (kids.body ?? []).length >= 1);

    const timeline = await api('/api/guardian/children/stu_demo_xiaoyu/timeline', {
      token: guardianToken,
    });
    ok('作品墙时间线有产出', timeline.status === 200 && (timeline.body?.items ?? []).length >= 1);

    const grants = await api('/api/guardian/children/stu_demo_xiaoyu/grants', {
      token: guardianToken,
    });
    ok('授权状态可读', grants.status === 200 && typeof grants.body?.VIS_L1 === 'boolean');

    const exported = await api('/api/guardian/children/stu_demo_xiaoyu/export', {
      token: guardianToken,
    });
    ok('导出全量数据可用（C11）', exported.status === 200 && !!exported.body?.student);

    // ── 8. 越权 ──────────────────────────────────────────
    console.log('\n[8] 可见性：越权一律 404（C7）');
    const otherKid = await api('/api/guardian/children/stu_demo_ranran/timeline', {
      token: guardianToken,
    });
    ok('家长读不到别人的孩子（404）', otherKid.status === 404);

    const anon = await api('/api/guardian/children/stu_demo_xiaoyu/timeline');
    ok('未登录访问被拒', anon.status === 401);
  } else {
    console.log('  ⚠ 家长登录未通过，跳过家长端与越权检查');
    console.log('    提示：开发模式验证码打印在服务端控制台，用 SMS_TEST_CODE 环境变量传入');
  }

  // ── 9. 学生注册 → 当堂登录 → 使用 的闭环 ───────────────
  console.log('\n[9] 闭环：家长注册孩子 → 讲师点名 → 学生当堂登录');
  // 用已登录的家长（短信链路在 [7] 已覆盖），避免重复跑时撞验证码限流
  const regToken = guardianToken;
  const childName = '闭环测试同学';
  let createdChild = null;
  if (regToken) {
    const before = await api('/api/guardian/children', { token: regToken });
    createdChild = (before.body ?? []).find((c) => c.displayName === childName) ?? null;

    if (!createdChild) {
      const createRes = await api('/api/guardian/children', {
        method: 'POST',
        token: regToken,
        body: {
          displayName: childName,
          grade: 4,
          avatarKey: 'a05',
          consents: { wall: true, media: false, data: true, crossTerm: false },
        },
      });
      ok('家长能注册孩子（监护人同意）', createRes.status === 201 && !!createRes.body?.id, detail(createRes));
      createdChild = createRes.body;
    } else {
      ok('家长能注册孩子（监护人同意）', true, '（复用上一次注册的）');
    }
    ok(
      '注册后同意状态逐项记录',
      createdChild?.consents?.wall === true &&
        createdChild?.consents?.media === false &&
        createdChild?.consents?.data === true &&
        createdChild?.consents?.crossTerm === false,
      JSON.stringify(createdChild?.consents),
    );

    // 撤回一项同意
    const revoke = await api(`/api/guardian/children/${createdChild?.id}/consents`, {
      method: 'POST',
      token: regToken,
      body: { scope: '影像', granted: false },
    });
    ok('同意项可随时撤回', revoke.status === 200 && revoke.body?.granted === false, detail(revoke));
  } else {
    ok('家长能注册孩子（监护人同意）', false, '家长端未登录，跳过');
  }

  // 讲师名册里能看到这个孩子
  const dir = await api('/api/students', { token: staffToken });
  const inDirectory = (dir.body ?? []).some((s) => s.displayName === childName);
  ok('讲师名册里能看到新注册的孩子', inDirectory, `名册 ${(dir.body ?? []).length} 人`);

  // 讲师点名：把新孩子加进这次课
  const session2 = await api('/api/sessions', {
    method: 'POST',
    token: staffToken,
    body: { lessonId: 'L1-02', roomName: '闭环测试教室', participantCount: 2 },
  });
  ok('建第二次课', session2.status === 201 && !!session2.body?.id, detail(session2));
  const session2Id = session2.body?.id;

  if (createdChild && session2Id) {
    // 这次课要有环节，学生才有东西可提交
    await api(`/api/sessions/${session2Id}/activities`, {
      method: 'PUT',
      token: staffToken,
      body: {
        activities: [
          { phase: '导入', modeCard: 'MODE_M3', title: '找一找身边的 AI', durationMin: 10, activityKind: 'VOTE' },
          { phase: '实操', modeCard: 'MODE_M2', title: '完成训练记录卡', durationMin: 50, activityKind: 'TASK' },
          { phase: '展示', modeCard: 'MODE_M6', title: '每人分享一次发现', durationMin: 20, activityKind: 'SUBMIT' },
          { phase: '收尾', modeCard: 'MODE_M1', title: '三句话收束', durationMin: 10, activityKind: 'BREAK' },
        ],
      },
    });

    const add = await api(`/api/sessions/${session2Id}/participants`, {
      method: 'POST',
      token: staffToken,
      body: { studentId: createdChild.id },
    });
    ok('讲师能把学员点名进班', add.status === 201 && add.body?.ok === true, detail(add));

    const opened2 = await api(`/api/sessions/${session2Id}/open`, { method: 'POST', token: staffToken });
    const code2 = opened2.body?.classCode;
    ok('开课拿到课堂码', typeof code2 === 'string' && /^\d{6}$/.test(code2), detail(opened2));

    const enter2 = await api('/api/auth/student/enter', { method: 'POST', body: { classCode: code2 } });
    ok(
      '新注册的学员出现在本班名单里',
      (enter2.body?.students ?? []).some((s) => s.displayName === childName),
      detail(enter2),
    );

    const pick2 = await api('/api/auth/student/pick', {
      method: 'POST',
      body: { classCode: code2, studentId: createdChild.id },
    });
    ok('学员能用课堂码进入课堂', pick2.status === 200 && !!pick2.body?.token, detail(pick2));
    const studentToken2 = pick2.body?.token;

    const sess2 = await api('/api/student/session', { token: studentToken2 });
    ok('学员看到当堂内容', sess2.status === 200 && !!sess2.body?.lessonTitle, detail(sess2));

    // 使用：提交作品
    const submit = await api('/api/student/submit', {
      method: 'POST',
      token: studentToken2,
      body: {
        activityId: sess2.body?.activities?.[0]?.id ?? 'x',
        title: '闭环测试作品',
        content: { note: '来自冒烟测试' },
        visibility: 'VIS_L0',
      },
    });
    ok('学员能提交作品', submit.status === 201, detail(submit));

    // 家长能看到孩子的作品
    const parentTimeline = await api(`/api/guardian/children/${createdChild.id}/timeline`, {
      token: regToken,
    });
    ok(
      '家长看到孩子刚交的作品（闭环合上）',
      (parentTimeline.body?.items ?? []).some((i) => i.title === '闭环测试作品'),
      detail(parentTimeline),
    );

    await api(`/api/sessions/${session2Id}/close`, { method: 'POST', token: staffToken });
  }

  // ── 汇总 ──────────────────────────────────────────────
  console.log('\n────────────────────────────────────────');
  console.log(`通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log(`  · ${f}`));
    process.exit(1);
  }
  console.log('全部通过 ✓');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
