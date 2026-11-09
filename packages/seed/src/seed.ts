/**
 * 数据入库 —— 把 48 节课、插件、演示班级写进数据库
 *
 * 三条纪律：
 *  - 细案原文入库，不改写
 *  - 未定稿的商业数据一律 NULL（C13）：报价、开班日期、课包档位
 *  - 演示数据只用于本地验收，全部带 demo 标记
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  GRADE_META,
  GRADE_LEVELS,
  type GradeLevel,
  type LessonPlanContent,
} from '@dreamcity/shared';
import { getDb, schema, runMigrations } from '@dreamcity/server';
import { ensureAdminAccount } from '@dreamcity/server';
import { ADMIN_USING_DEFAULT_PASSWORD, env } from '@dreamcity/server';

interface LessonsFile {
  lessonCount: number;
  lessons: {
    id: string;
    level: string;
    seq: number;
    title: string;
    unitId: string;
    unitName: string;
    unitSeq: number;
    defaultRecipe: string | null;
    output: string;
    totalMinutes: number;
    canonicalMinutes: Record<string, number>;
    plan: LessonPlanContent;
  }[];
}

interface ManifestFile {
  plugins: {
    id: string;
    name: string;
    version: string;
    entry: string;
    result_schema: Record<string, string>;
    [key: string]: unknown;
  }[];
}

const ROOT = resolve(import.meta.dirname, '../../..');

/** 演示账号（仅本地开发用） */
const DEMO = {
  teacherEmail: 'teacher@dreamcity.cn',
  teacherPassword: 'dreamcity-demo',
  teacherName: '创始人（演示）',
  guardianPhone: '13800000001',
  guardianName: '小宇妈妈（演示）',
  guardianPhone2: '13800000002',
  guardianName2: '然然妈妈（演示）',
};

async function main(): Promise<void> {
  // 先跑迁移，保证表结构是最新的
  const applied = await runMigrations();
  if (applied.length > 0) {
    console.log(`✓ 已执行 ${applied.length} 个迁移：${applied.join(', ')}`);
  }

  // 后台占位账号：与 env 对齐（幂等）。短信没接上时，这是唯一的后台入口。
  await ensureAdminAccount();
  if (env.admin.enabled) {
    console.log(
      ADMIN_USING_DEFAULT_PASSWORD
        ? `✓ 后台占位账号已就位：${env.admin.user}（口令为开发默认值，正式用前请设 ADMIN_PASSWORD）`
        : `✓ 后台占位账号已就位：${env.admin.user}（口令取自 ADMIN_PASSWORD）`,
    );
  } else {
    console.log('✓ 后台占位账号已关闭（ADMIN_ENABLED=false）');
  }

  await seedContent();
  // 生产上线只要内容，不要演示班级：`npm run seed:content`
  if (!process.argv.includes('--no-demo')) {
    await seedDemo();
  }
}

/**
 * 内容入库：级别 / 单元 / 48 节课 / 教案版本 / 插件。
 * 生产环境只需要这一部分。
 */
export async function seedContent(): Promise<void> {
  const db = getDb();

  /* ── 1. 级别 ──────────────────────────────────────────── */

  for (const id of GRADE_LEVELS) {
    const meta = GRADE_META[id];
    await db
      .insert(schema.level)
      .values({
        id,
        code: meta.code,
        name: meta.name,
        gradeRange: meta.gradeRange,
        theme: meta.theme,
        seq: meta.seq,
        goals: [],
      })
      .onConflictDoUpdate({
        target: schema.level.id,
        set: {
          name: meta.name,
          gradeRange: meta.gradeRange,
          theme: meta.theme,
          seq: meta.seq,
        },
      });
  }
  console.log(`✓ 级别 ${GRADE_LEVELS.length} 个`);

  /* ── 2. 课次 + 教案版本 ──────────────────────────────── */

  const lessonsFile = JSON.parse(
    await readFile(resolve(ROOT, 'content/lessons.json'), 'utf8'),
  ) as LessonsFile;

  const units = new Map<string, { id: string; levelId: GradeLevel; seq: number; name: string }>();
  for (const l of lessonsFile.lessons) {
    units.set(l.unitId, {
      id: l.unitId,
      levelId: `GRADE_${l.level}` as GradeLevel,
      seq: l.unitSeq,
      name: l.unitName,
    });
  }
  for (const u of units.values()) {
    await db
      .insert(schema.unit)
      .values(u)
      .onConflictDoUpdate({ target: schema.unit.id, set: { name: u.name, seq: u.seq } });
  }

  for (const l of lessonsFile.lessons) {
    const levelId = `GRADE_${l.level}` as GradeLevel;

    const existing = await db
      .select()
      .from(schema.lessonPlanVersion)
      .where(eq(schema.lessonPlanVersion.lessonId, l.id))
      .orderBy(schema.lessonPlanVersion.version);
    if (existing.length > 0) continue; // 已有教案版本就不覆盖

    const versionId = `lpv_${l.id}_v1`;

    // 先建 lesson（current_version_id 留空），再建版本，最后回填 —— 两张表互相引用
    await db
      .insert(schema.lesson)
      .values({
        id: l.id,
        unitId: l.unitId,
        levelId,
        seq: l.seq,
        title: l.title,
        output: l.output,
        defaultRecipe: l.defaultRecipe,
        currentVersionId: null,
      })
      .onConflictDoNothing();

    await db.insert(schema.lessonPlanVersion).values({
      id: versionId,
      lessonId: l.id,
      version: 1,
      contentJson: {
        ...l.plan,
        totalMinutes: l.totalMinutes,
        canonicalMinutes: l.canonicalMinutes,
      } as unknown as Record<string, unknown>,
      note: 'V1.0 原文入库',
      createdBy: 'seed',
    });

    await db
      .update(schema.lesson)
      .set({ currentVersionId: versionId })
      .where(eq(schema.lesson.id, l.id));
  }
  console.log(`✓ 课次 ${lessonsFile.lessons.length} 节 + 单元 ${units.size} 个`);

  /* ── 3. 插件 ─────────────────────────────────────────── */

  const manifest = JSON.parse(
    await readFile(resolve(ROOT, 'activities/manifest.json'), 'utf8'),
  ) as ManifestFile;

  for (const p of manifest.plugins) {
    await db
      .insert(schema.activityPlugin)
      .values({
        id: p.id,
        name: p.name,
        version: p.version,
        entry: p.entry,
        manifestJson: p as unknown as Record<string, unknown>,
        resultSchema: p.result_schema as unknown as Record<string, unknown>,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: schema.activityPlugin.id,
        set: {
          name: p.name,
          version: p.version,
          entry: p.entry,
          manifestJson: p as unknown as Record<string, unknown>,
          resultSchema: p.result_schema as unknown as Record<string, unknown>,
        },
      });
  }
  console.log(`✓ 插件 ${manifest.plugins.length} 个`);
}

/**
 * 演示数据：只用于本地开发与验收。
 * ⚠️ 生产上线不要跑这一段 —— 里面是公开的演示账号密码。
 */
async function seedDemo(): Promise<void> {
  const db = getDb();

  // 演示班级：2 名 4 年级学生（开发上下文 §4.4：首次试课样本）
  const { hashPassword } = await import('@dreamcity/server');

  const teacherId = 'stf_demo_teacher';
  await db
    .insert(schema.staffUser)
    .values({
      id: teacherId,
      email: DEMO.teacherEmail,
      name: DEMO.teacherName,
      role: 'TEACHER',
      passwordHash: hashPassword(DEMO.teacherPassword),
    })
    .onConflictDoNothing();

  const guardians = [
    { id: 'grd_demo_1', phone: DEMO.guardianPhone, name: DEMO.guardianName },
    { id: 'grd_demo_2', phone: DEMO.guardianPhone2, name: DEMO.guardianName2 },
  ];
  for (const g of guardians) {
    await db
      .insert(schema.guardian)
      .values({ id: g.id, phone: g.phone, name: g.name, smsVerifiedAt: new Date() })
      .onConflictDoNothing();
  }

  const students = [
    { id: 'stu_demo_xiaoyu', guardianId: 'grd_demo_1', displayName: '小宇', avatarKey: 'mascot-L1', grade: 4 },
    { id: 'stu_demo_ranran', guardianId: 'grd_demo_2', displayName: '然然', avatarKey: 'mascot-L2', grade: 4 },
  ];
  for (const s of students) {
    await db
      .insert(schema.student)
      .values({
        id: s.id,
        guardianId: s.guardianId,
        displayName: s.displayName,
        avatarKey: s.avatarKey,
        avatarStage: 1,
        grade: s.grade,
        levelId: 'GRADE_L1',
        badge: [],
        state: 'ACTIVE',
      })
      .onConflictDoNothing();
  }

  // 期次：开班日期待人工拍板（Q7）→ 存 NULL
  const termId = 'trm_demo_l1';
  await db
    .insert(schema.term)
    .values({
      id: termId,
      name: 'L1 启蒙级第一期（演示）',
      levelId: 'GRADE_L1',
      startDate: null,
      endDate: null,
      status: 'RUNNING',
    })
    .onConflictDoNothing();

  for (const s of students) {
    await db
      .insert(schema.enrollment)
      .values({
        id: `enr_demo_${s.id}`,
        studentId: s.id,
        termId,
        packageType: null, // 课包档位待定
        totalLessons: 16,
        usedLessons: 1,
        price: null, // 报价按 ≥2 人小班重定，未定稿前不填（C13）
        status: 'ACTIVE',
      })
      .onConflictDoNothing();
  }

  // 报名环节的一次性授权：同班可见（VIS_L1）
  for (const g of guardians) {
    for (const s of students.filter((x) => x.guardianId === g.id)) {
      await db
        .insert(schema.visibilityGrant)
        .values({
          id: `vg_demo_${s.id}_L1`,
          guardianId: g.id,
          studentId: s.id,
          scope: 'VIS_L1',
          artifactId: null,
        })
        .onConflictDoNothing();
    }
    await db
      .insert(schema.consent)
      .values({
        id: `cs_demo_${g.id}_wall`,
        guardianId: g.id,
        scope: '作品上墙',
      })
      .onConflictDoNothing();
  }

  /* ── 5. 一次已完成的课（验收用）──────────────────────── */
  const sessionId = 'ses_demo_l1_01';
  const sessionExists = await db
    .select()
    .from(schema.classSession)
    .where(eq(schema.classSession.id, sessionId))
    .limit(1);

  if (sessionExists.length === 0) {
    const version = await db
      .select()
      .from(schema.lessonPlanVersion)
      .where(eq(schema.lessonPlanVersion.lessonId, 'L1-01'))
      .limit(1);

    const startedAt = new Date('2026-11-02T09:00:00+08:00');
    const endedAt = new Date('2026-11-02T10:30:00+08:00');

    await db.insert(schema.classSession).values({
      id: sessionId,
      lessonId: 'L1-01',
      planVersionId: version[0]!.id,
      termId,
      teacherId,
      roomName: '南山教室 A（演示）',
      classType: 'SMALL_GROUP',
      participantCount: 2,
      state: 'CLOSED',
      startedAt,
      endedAt,
    });

    for (const s of students) {
      await db.insert(schema.classSessionParticipant).values({
        id: `csp_demo_${s.id}`,
        sessionId,
        studentId: s.id,
        joinedAt: startedAt,
      });
    }

    // 编排：按 L1-01 的默认配方
    const activities = [
      { phase: '导入', modeCard: 'MODE_M3', atom: 'ATOM_A3', title: '贴纸游戏「AI找一找」', durationMin: 10, kind: 'VOTE' },
      { phase: '讲解', modeCard: 'MODE_M1', atom: 'ATOM_A1', title: '图片卡二分：人做的 / 机器做的', durationMin: 20, kind: 'LESSON_PDF' },
      { phase: '实操', modeCard: 'MODE_M2', atom: 'ATOM_A2', title: '完成《我的AI发现清单》', durationMin: 40, kind: 'TASK' },
      { phase: '实操', modeCard: 'MODE_M5', atom: 'ATOM_A5', title: '讲师巡场点拨', durationMin: 10, kind: 'BREAK' },
      { phase: '展示', modeCard: 'MODE_M6', atom: 'ATOM_A6', title: '每人分享一个最意外的发现', durationMin: 15, kind: 'SUBMIT' },
      { phase: '收尾', modeCard: 'MODE_M1', atom: 'ATOM_A1', title: '三句话收束 + 离场复述', durationMin: 5, kind: 'BREAK' },
    ];
    let seq = 0;
    for (const a of activities) {
      seq += 1;
      await db.insert(schema.sessionActivity).values({
        id: `sa_demo_${seq}`,
        sessionId,
        seq,
        phase: a.phase,
        modeCard: a.modeCard,
        atom: a.atom,
        title: a.title,
        durationMin: a.durationMin,
        activityKind: a.kind,
      });
    }

    // 产出
    const artifacts = [
      { studentId: 'stu_demo_xiaoyu', title: '《我的AI发现清单》', content: { count: 5, sample: '刷脸门禁、扫地机器人、短视频推荐' } },
      { studentId: 'stu_demo_ranran', title: '《我的AI发现清单》', content: { count: 5, sample: '语音助手、拍照搜题、导航' } },
    ];
    for (const a of artifacts) {
      const artifactId = `art_demo_${a.studentId}`;
      await db.insert(schema.artifact).values({
        id: artifactId,
        sessionId,
        studentId: a.studentId,
        lessonId: 'L1-01',
        artifactType: '任务单',
        title: a.title,
        contentJson: a.content,
        visibility: 'VIS_L0',
        wallApproved: false,
      });
      await db.insert(schema.showcase).values({
        id: `sc_demo_${a.studentId}`,
        studentId: a.studentId,
        sessionId,
        artifactId,
        title: a.title,
        visibility: 'VIS_L0',
        wallApproved: false,
      });
    }

    // 六指标
    for (const [i, s] of students.entries()) {
      await db.insert(schema.observation).values({
        id: `obs_demo_${s.id}`,
        sessionId,
        studentId: s.id,
        speakCount: 2,
        patrolCount: i === 0 ? 2 : 1,
        stuckCount: i === 0 ? 0 : 1,
        taskCompletion: 1,
      });
    }

    // 家长反馈
    await db.insert(schema.studentFeedback).values({
      id: `fb_demo_${sessionId}`,
      sessionId,
      studentId: 'stu_demo_xiaoyu',
      content: '今天上了《L1-01 你好，AI朋友》。孩子在教室里找出了 5 个身边的 AI，写下了《我的AI发现清单》。',
      teacherComment: '小宇今天举手比上周多，能说清楚「AI 会认错」这件事，很棒。',
      nextStep: '下节课我们一起训练一个只认苹果和橘子的 AI。',
      sentAt: new Date('2026-11-02T12:00:00+08:00'),
    });

    // 同伴留言（VIS_L1 内的正向互评）
    await db.insert(schema.peerNote).values({
      id: 'pn_demo_1',
      showcaseId: 'sc_demo_stu_demo_xiaoyu',
      fromStudentId: 'stu_demo_ranran',
      noteType: '喜欢',
      content: '我喜欢小宇写的「刷脸门禁」那条，因为它还写了是谁在用。',
      reviewState: 'APPROVED',
    });

    console.log('✓ 演示班级与一次已完成的课');
  }

  console.log('\n演示账号（仅本地开发）：');
  console.log(`  讲师  ${DEMO.teacherEmail} / ${DEMO.teacherPassword}`);
  console.log(`  家长  ${DEMO.guardianPhone}（验证码在服务端控制台打印）`);
  console.log(`  家长  ${DEMO.guardianPhone2}`);
  console.log('  学员  课堂码进入后点头像即可（无密码）');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
