/**
 * 家长端路由 —— 只读价值层，不碰执行层（设计方案 §4.2）
 *
 * 家长打开 3 秒内要看到：孩子这节课做出了什么 → 老师一句话点评 → 比上次进步 → 剩余课时。
 * 所以首页是「最新一节课倒序的时间线」，不是功能宫格。
 */

import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../db/driver.js';
import { requireGuardian } from '../../middleware/guards.js';
import {
  NotFoundError,
  getGrantState,
  isGuardianOf,
  revokeGrants,
  visibleScopesFor,
} from '../visibility/service.js';
import {
  CONSENT_SCOPES,
  GRADE_META,
  isAvatarKey,
  type ConsentScope,
  type ConsentState,
  type GradeLevel,
} from '@dreamcity/shared';

/** 把 consent 表的行还原成四项开关 */
function consentStateOf(
  rows: { studentId: string | null; scope: string; revokedAt: Date | null }[],
  studentId: string,
): ConsentState {
  const mine = rows.filter((r) => r.studentId === studentId);
  const on = (scope: ConsentScope) =>
    mine.some((r) => r.scope === scope && r.revokedAt === null);
  return {
    wall: on('作品上墙'),
    media: on('影像'),
    data: on('数据'),
    crossTerm: on('跨期'),
  };
}

export async function registerGuardianRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  /* ── 我的孩子 ────────────────────────────────────────── */

  app.get('/api/guardian/children', { preHandler: requireGuardian }, async (req) => {
    const rows = await db
      .select({
        id: schema.student.id,
        displayName: schema.student.displayName,
        avatarKey: schema.student.avatarKey,
        avatarStage: schema.student.avatarStage,
        grade: schema.student.grade,
        levelId: schema.student.levelId,
        state: schema.student.state,
      })
      .from(schema.student)
      .where(eq(schema.student.guardianId, req.viewer!.id))
      .orderBy(asc(schema.student.createdAt));

    const consents = await db
      .select()
      .from(schema.consent)
      .where(eq(schema.consent.guardianId, req.viewer!.id));

    return rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      avatarKey: r.avatarKey,
      avatarStage: r.avatarStage,
      grade: r.grade,
      levelId: r.levelId,
      state: r.state,
      levelName: r.levelId ? GRADE_META[r.levelId as GradeLevel]?.name : null,
      consents: consentStateOf(consents, r.id),
    }));
  });

  /**
   * 添加孩子 —— 监护人完成注册（封闭域内的注册，不做开放注册）
   *
   * 这一步同时完成三件事：
   *  1. 建立学员身份（昵称制，不采集真实姓名与正脸照）
   *  2. 逐项记录监护人知情同意（可随时撤回）
   *  3. 建一份报读（期次待定，不编造开班日期）
   */
  app.post('/api/guardian/children', { preHandler: requireGuardian }, async (req, reply) => {
    const body = z
      .object({
        displayName: z.string().trim().min(1).max(10),
        grade: z.number().int().min(3).max(9),
        avatarKey: z.string().min(1),
        consents: z.object({
          wall: z.boolean(),
          media: z.boolean(),
          data: z.boolean(),
          crossTerm: z.boolean(),
        }),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '信息填得不太对，再看看' });
    }
    if (!isAvatarKey(body.data.avatarKey)) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '换一个头像试试' });
    }

    const guardianId = req.viewer!.id;
    const studentId = `stu_${crypto.randomUUID()}`;

    await db.insert(schema.student).values({
      id: studentId,
      guardianId,
      displayName: body.data.displayName,
      avatarKey: body.data.avatarKey,
      avatarStage: 1,
      grade: body.data.grade,
      // 级别由排课定，不在这里臆造
      levelId: null,
      badge: [],
      state: 'ACTIVE',
    });

    // 逐项知情同意：同意的写授权，不同意的也留一条“未授权”记录（可随时改）
    const scopeMap: [ConsentScope, boolean][] = [
      ['作品上墙', body.data.consents.wall],
      ['影像', body.data.consents.media],
      ['数据', body.data.consents.data],
      ['跨期', body.data.consents.crossTerm],
    ];
    for (const [scope, granted] of scopeMap) {
      await db.insert(schema.consent).values({
        id: `cs_${crypto.randomUUID()}`,
        guardianId,
        studentId,
        scope,
        grantedAt: new Date(),
        // 没同意的：立刻标记为已撤回，等于「未授权」
        revokedAt: granted ? null : new Date(),
      });
    }

    return reply.code(201).send({
      id: studentId,
      displayName: body.data.displayName,
      avatarKey: body.data.avatarKey,
      avatarStage: 1,
      grade: body.data.grade,
      levelId: null,
      state: 'ACTIVE',
      consents: body.data.consents,
    });
  });

  /** 撤回或补上某一项知情同意 */
  app.post('/api/guardian/children/:id/consents', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({ scope: z.enum(CONSENT_SCOPES), granted: z.boolean() })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    }
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    const existing = await db
      .select()
      .from(schema.consent)
      .where(
        and(
          eq(schema.consent.guardianId, req.viewer!.id),
          eq(schema.consent.studentId, params.data.id),
          eq(schema.consent.scope, body.data.scope),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.consent)
        .set({ revokedAt: body.data.granted ? null : new Date() })
        .where(eq(schema.consent.id, existing[0].id));
    } else {
      await db.insert(schema.consent).values({
        id: `cs_${crypto.randomUUID()}`,
        guardianId: req.viewer!.id,
        studentId: params.data.id,
        scope: body.data.scope,
        grantedAt: new Date(),
        revokedAt: body.data.granted ? null : new Date(),
      });
    }
    return { ok: true, scope: body.data.scope, granted: body.data.granted };
  });

  /* ── 作品墙时间线 ────────────────────────────────────── */

  app.get('/api/guardian/children/:id/timeline', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    const artifacts = await db
      .select({
        id: schema.artifact.id,
        studentId: schema.artifact.studentId,
        sessionId: schema.artifact.sessionId,
        lessonId: schema.artifact.lessonId,
        artifactType: schema.artifact.artifactType,
        title: schema.artifact.title,
        contentJson: schema.artifact.contentJson,
        visibility: schema.artifact.visibility,
        wallApproved: schema.artifact.wallApproved,
        createdAt: schema.artifact.createdAt,
        lessonTitle: schema.lesson.title,
      })
      .from(schema.artifact)
      .leftJoin(schema.lesson, eq(schema.lesson.id, schema.artifact.lessonId))
      .where(eq(schema.artifact.studentId, params.data.id))
      .orderBy(desc(schema.artifact.createdAt));

    // 服务端可见性过滤：越权的不出现在结果里（C7）
    const scopes = await visibleScopesFor(req.viewer!, params.data.id);
    const visible = artifacts.filter((a) => scopes.has(a.visibility as never));

    const feedback = await db
      .select()
      .from(schema.studentFeedback)
      .where(eq(schema.studentFeedback.studentId, params.data.id))
      .orderBy(desc(schema.studentFeedback.createdAt));

    const enrollment = await db
      .select()
      .from(schema.enrollment)
      .where(eq(schema.enrollment.studentId, params.data.id))
      .limit(1);

    const sessionIds = [...new Set(visible.map((a) => a.sessionId).filter((s): s is string => !!s))];
    const teacherComments = sessionIds.length
      ? await db
          .select()
          .from(schema.studentFeedback)
          .where(inArray(schema.studentFeedback.sessionId, sessionIds))
          .orderBy(desc(schema.studentFeedback.createdAt))
      : [];

    return {
      items: visible.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        sessionId: a.sessionId,
        lessonId: a.lessonId,
        lessonTitle: a.lessonTitle,
        type: a.artifactType,
        title: a.title,
        content: a.contentJson,
        visibility: a.visibility,
        wallApproved: a.wallApproved,
        createdAt: a.createdAt.toISOString(),
        teacherComment:
          teacherComments.find((f) => f.sessionId === a.sessionId)?.teacherComment ?? null,
      })),
      feedback: feedback.map((f) => ({
        id: f.id,
        sessionId: f.sessionId,
        content: f.content,
        teacherComment: f.teacherComment,
        nextStep: f.nextStep,
        sentAt: f.sentAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
      })),
      remainingLessons:
        enrollment[0] && enrollment[0].totalLessons !== null
          ? enrollment[0].totalLessons - enrollment[0].usedLessons
          : null,
      totalLessons: enrollment[0]?.totalLessons ?? null,
    };
  });

  /* ── 成长档案 ────────────────────────────────────────── */

  app.get('/api/guardian/children/:id/profile', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    const rows = await db.select().from(schema.student).where(eq(schema.student.id, params.data.id)).limit(1);
    const s = rows[0];
    if (!s) throw new NotFoundError();

    const artifactCount = await db
      .select({ id: schema.artifact.id })
      .from(schema.artifact)
      .where(eq(schema.artifact.studentId, s.id));

    const enrollment = await db
      .select()
      .from(schema.enrollment)
      .where(eq(schema.enrollment.studentId, s.id))
      .limit(1);

    return {
      studentId: s.id,
      displayName: s.displayName,
      avatarKey: s.avatarKey,
      avatarStage: s.avatarStage,
      levelId: s.levelId,
      levelName: s.levelId ? GRADE_META[s.levelId as GradeLevel]?.name : null,
      grade: s.grade,
      badge: s.badge,
      completedLessons: enrollment[0]?.usedLessons ?? 0,
      totalLessons: enrollment[0]?.totalLessons ?? null,
      remainingLessons:
        enrollment[0] && enrollment[0].totalLessons !== null
          ? enrollment[0].totalLessons - enrollment[0].usedLessons
          : null,
      artifacts: artifactCount.length,
    };
  });

  /* ── 可见范围与授权（G6，合规必备）───────────────────── */

  app.get('/api/guardian/children/:id/grants', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }
    const state = await getGrantState(req.viewer!.id, params.data.id);
    return {
      VIS_L1: state.VIS_L1,
      VIS_L2: state.VIS_L2,
      VIS_L3: state.VIS_L3,
      items: state.items.map((g) => ({
        id: g.id,
        scope: g.scope,
        artifactId: g.artifactId,
        grantedAt: g.grantedAt.toISOString(),
        revokedAt: g.revokedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/api/guardian/children/:id/grants', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({
        scope: z.enum(['VIS_L1', 'VIS_L2', 'VIS_L3']),
        artifactId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    }
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    // VIS_L3 必须逐件授权：必须指定 artifactId
    if (body.data.scope === 'VIS_L3' && !body.data.artifactId) {
      return reply.code(400).send({
        error: 'PER_ITEM_REQUIRED',
        message: '对外分享要逐件授权，请先选一件作品',
      });
    }

    const id = `vg_${crypto.randomUUID()}`;
    await db.insert(schema.visibilityGrant).values({
      id,
      guardianId: req.viewer!.id,
      studentId: params.data.id,
      scope: body.data.scope,
      artifactId: body.data.artifactId ?? null,
    });
    return reply.code(201).send({ id, scope: body.data.scope });
  });

  /** 逐件可撤回（C10） */
  app.post('/api/guardian/children/:id/grants/revoke', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({ scope: z.enum(['VIS_L1', 'VIS_L2', 'VIS_L3']), artifactId: z.string().nullable().optional() })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    }
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }
    const revoked = await revokeGrants(
      req.viewer!.id,
      params.data.id,
      body.data.scope,
      body.data.artifactId ?? null,
    );
    return { revoked };
  });

  /* ── 孩子收到的每一条留言 ────────────────────────────── */

  app.get('/api/guardian/children/:id/notes', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    const notes = await db
      .select({
        id: schema.peerNote.id,
        noteType: schema.peerNote.noteType,
        content: schema.peerNote.content,
        createdAt: schema.peerNote.createdAt,
        fromName: schema.student.displayName,
        showcaseTitle: schema.showcase.title,
      })
      .from(schema.peerNote)
      .innerJoin(schema.showcase, eq(schema.showcase.id, schema.peerNote.showcaseId))
      .innerJoin(schema.student, eq(schema.student.id, schema.peerNote.fromStudentId))
      .where(eq(schema.showcase.studentId, params.data.id))
      .orderBy(desc(schema.peerNote.createdAt));

    return notes.map((n) => ({
      id: n.id,
      noteType: n.noteType,
      content: n.content,
      createdAt: n.createdAt.toISOString(),
      fromName: n.fromName,
      showcaseTitle: n.showcaseTitle,
    }));
  });

  /* ── 导出全量数据（C11）──────────────────────────────── */

  app.get('/api/guardian/children/:id/export', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }
    const studentId = params.data.id;

    const [student, artifacts, showcases, notes, feedback, grants, consents, enrollment] =
      await Promise.all([
        db.select().from(schema.student).where(eq(schema.student.id, studentId)),
        db.select().from(schema.artifact).where(eq(schema.artifact.studentId, studentId)),
        db.select().from(schema.showcase).where(eq(schema.showcase.studentId, studentId)),
        db
          .select({
            note: schema.peerNote,
            fromName: schema.student.displayName,
          })
          .from(schema.peerNote)
          .innerJoin(schema.showcase, eq(schema.showcase.id, schema.peerNote.showcaseId))
          .innerJoin(schema.student, eq(schema.student.id, schema.peerNote.fromStudentId))
          .where(eq(schema.showcase.studentId, studentId)),
        db.select().from(schema.studentFeedback).where(eq(schema.studentFeedback.studentId, studentId)),
        db.select().from(schema.visibilityGrant).where(eq(schema.visibilityGrant.studentId, studentId)),
        db.select().from(schema.consent).where(eq(schema.consent.studentId, studentId)),
        db.select().from(schema.enrollment).where(eq(schema.enrollment.studentId, studentId)),
      ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: 'guardian',
      student: student[0] ?? null,
      artifacts,
      showcases,
      peerNotes: notes.map((n) => ({ ...n.note, fromName: n.fromName })),
      feedback,
      visibilityGrants: grants,
      consents,
      enrollment: enrollment[0] ?? null,
    };

    reply.header('Content-Disposition', `attachment; filename="dreamcity-${studentId}.json"`);
    return payload;
  });

  /* ── 注销账号（C11；需监护人确认）────────────────────── */

  app.delete('/api/guardian/children/:id', { preHandler: requireGuardian }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    if (!(await isGuardianOf(req.viewer!.id, params.data.id))) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }
    // 软注销：账号不因结业注销，但家长可以要求注销（保留数据以符合留存约定）
    await db
      .update(schema.student)
      .set({ state: 'DEACTIVATED' })
      .where(eq(schema.student.id, params.data.id));
    return { ok: true, state: 'DEACTIVATED' };
  });
}
