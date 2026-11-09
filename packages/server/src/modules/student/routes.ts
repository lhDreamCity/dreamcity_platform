/**
 * 学生端路由 —— 最薄的一端
 *
 * 课堂码进入 → 选头像 → 参与活动 → 提交作品 → 看自己的展位。
 * 无密码、无信息流、无推送，用完即走（设计方案 §2.3.2）。
 */

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../db/driver.js';
import { requireStudent } from '../../middleware/guards.js';
import { NotFoundError, visibleScopesFor } from '../visibility/service.js';
import { GRADE_META, type GradeLevel } from '@dreamcity/shared';

/** 跨期留言只准这三类句式（开发上下文 §6.3） */
const NOTE_TYPES = ['注意到', '喜欢', '想问'] as const;

export async function registerStudentRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  /* ── 当堂：这一节要一起做的事 ────────────────────────── */

  app.get('/api/student/session', { preHandler: requireStudent }, async (req, reply) => {
    const sessionId = req.token!.sid;
    if (!sessionId) {
      return reply.code(404).send({ error: 'NO_SESSION', message: '现在没有课在进行' });
    }

    const sessions = await db
      .select({
        id: schema.classSession.id,
        lessonId: schema.classSession.lessonId,
        state: schema.classSession.state,
        lessonTitle: schema.lesson.title,
      })
      .from(schema.classSession)
      .innerJoin(schema.lesson, eq(schema.lesson.id, schema.classSession.lessonId))
      .where(eq(schema.classSession.id, sessionId))
      .limit(1);
    const session = sessions[0];
    if (!session || session.state !== 'LIVE') {
      return reply.code(404).send({ error: 'NO_SESSION', message: '现在没有课在进行' });
    }

    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, sessionId))
      .orderBy(schema.sessionActivity.seq);

    const entries = await db
      .select({ activityId: schema.sessionActivity.id, entry: schema.activityPlugin.entry })
      .from(schema.sessionActivity)
      .leftJoin(
        schema.activityPlugin,
        eq(schema.activityPlugin.id, schema.sessionActivity.pluginId),
      )
      .where(eq(schema.sessionActivity.sessionId, sessionId));

    const entryMap = new Map(entries.map((e) => [e.activityId, e.entry]));

    const student = await db
      .select()
      .from(schema.student)
      .where(eq(schema.student.id, req.viewer!.id))
      .limit(1);

    return {
      sessionId: session.id,
      lessonId: session.lessonId,
      lessonTitle: session.lessonTitle,
      student: student[0]
        ? {
            id: student[0].id,
            displayName: student[0].displayName,
            avatarKey: student[0].avatarKey,
            avatarStage: student[0].avatarStage,
          }
        : null,
      activities: activities.map((a) => ({
        id: a.id,
        seq: a.seq,
        phase: a.phase,
        title: a.title,
        durationMin: a.durationMin,
        activityKind: a.activityKind,
        entry: entryMap.get(a.id) ?? null,
      })),
    };
  });

  /* ── 提交作品（回传带 visibility，默认私密）───────────── */

  app.post('/api/student/submit', { preHandler: requireStudent }, async (req, reply) => {
    const body = z
      .object({
        activityId: z.string().min(1),
        title: z.string().min(1).max(120),
        content: z.record(z.string(), z.unknown()).default({}),
        visibility: z.enum(['VIS_L0', 'VIS_L1']).default('VIS_L0'),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '交的东西看不懂，再试一次' });
    }

    const sessionId = req.token!.sid;
    if (!sessionId) return reply.code(404).send({ error: 'NO_SESSION', message: '现在没有课在进行' });

    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.id, body.data.activityId),
          eq(schema.sessionActivity.sessionId, sessionId),
        ),
      )
      .limit(1);
    const activity = activities[0];
    if (!activity) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个活动' });

    const studentId = req.viewer!.id;
    const artifactId = `art_${crypto.randomUUID()}`;
    await db.insert(schema.artifact).values({
      id: artifactId,
      sessionId,
      studentId,
      lessonId: null,
      artifactType: activity.activityKind === 'TASK' ? '任务单' : '作品',
      title: body.data.title,
      contentJson: body.data.content,
      visibility: body.data.visibility,
      wallApproved: false,
    });

    await db.insert(schema.showcase).values({
      id: `sc_${crypto.randomUUID()}`,
      studentId,
      sessionId,
      artifactId,
      title: body.data.title,
      visibility: body.data.visibility,
      wallApproved: false,
    });

    await db.insert(schema.sessionRecord).values({
      id: `sr_${crypto.randomUUID()}`,
      sessionId,
      sessionActivityId: activity.id,
      recordType: 'ACTIVITY_RESULT',
      studentId,
      eventJson: { payload: body.data.content, visibility: body.data.visibility },
    });

    return reply.code(201).send({ artifactId });
  });

  /* ── 我的展位（人人有份，按时间排序，不按优劣）──────── */

  app.get('/api/student/showcase', { preHandler: requireStudent }, async (req) => {
    const studentId = req.viewer!.id;

    const student = await db
      .select()
      .from(schema.student)
      .where(eq(schema.student.id, studentId))
      .limit(1);

    const items = await db
      .select({
        id: schema.showcase.id,
        title: schema.showcase.title,
        visibility: schema.showcase.visibility,
        createdAt: schema.showcase.createdAt,
        artifactId: schema.showcase.artifactId,
        content: schema.artifact.contentJson,
        artifactType: schema.artifact.artifactType,
      })
      .from(schema.showcase)
      .leftJoin(schema.artifact, eq(schema.artifact.id, schema.showcase.artifactId))
      .where(eq(schema.showcase.studentId, studentId))
      .orderBy(desc(schema.showcase.createdAt));

    const scopes = await visibleScopesFor(req.viewer!, studentId);

    const ids = items.map((i) => i.id);
    const notes = ids.length
      ? await db
          .select({
            id: schema.peerNote.id,
            showcaseId: schema.peerNote.showcaseId,
            noteType: schema.peerNote.noteType,
            content: schema.peerNote.content,
            createdAt: schema.peerNote.createdAt,
            fromName: schema.student.displayName,
          })
          .from(schema.peerNote)
          .innerJoin(schema.student, eq(schema.student.id, schema.peerNote.fromStudentId))
          .where(
            and(
              inArray(schema.peerNote.showcaseId, ids),
              eq(schema.peerNote.reviewState, 'APPROVED'),
            ),
          )
          .orderBy(desc(schema.peerNote.createdAt))
      : [];

    // 「谁看过」：只列名字与关系，不显示任何数字（C8）
    const views = ids.length
      ? await db
          .select({
            artifactId: schema.artifactView.artifactId,
            relation: schema.artifactView.relation,
            viewedAt: schema.artifactView.viewedAt,
            studentName: schema.student.displayName,
            guardianName: schema.guardian.name,
          })
          .from(schema.artifactView)
          .leftJoin(
            schema.student,
            eq(schema.student.id, schema.artifactView.viewerStudentId),
          )
          .leftJoin(
            schema.guardian,
            eq(schema.guardian.id, schema.artifactView.viewerGuardianId),
          )
          .where(inArray(schema.artifactView.artifactId, items.map((i) => i.artifactId).filter((a): a is string => !!a)))
      : [];

    return {
      student: student[0]
        ? {
            id: student[0].id,
            displayName: student[0].displayName,
            avatarKey: student[0].avatarKey,
            avatarStage: student[0].avatarStage,
            levelId: student[0].levelId,
            levelName: student[0].levelId
              ? GRADE_META[student[0].levelId as GradeLevel]?.name
              : null,
            badge: student[0].badge,
          }
        : null,
      items: items.map((i) => ({
        id: i.id,
        title: i.title,
        visibility: i.visibility,
        createdAt: i.createdAt.toISOString(),
        artifactId: i.artifactId,
        content: i.content,
        type: i.artifactType,
        notes: notes
          .filter((n) => n.showcaseId === i.id)
          .map((n) => ({
            id: n.id,
            noteType: n.noteType,
            content: n.content,
            createdAt: n.createdAt.toISOString(),
            fromName: n.fromName,
          })),
        viewedBy: views
          .filter((v) => v.artifactId === i.artifactId)
          .map((v) => ({
            name: v.studentName ?? v.guardianName ?? '有人',
            relation: v.relation,
          })),
      })),
      visibleScopes: [...scopes],
    };
  });

  /* ── 本班作品墙（同伴互评 A4）────────────────────────── */

  app.get('/api/student/wall', { preHandler: requireStudent }, async (req) => {
    const sessionId = req.token!.sid;
    if (!sessionId) return { items: [] };

    const peers = await db
      .selectDistinct({ studentId: schema.classSessionParticipant.studentId })
      .from(schema.classSessionParticipant)
      .where(eq(schema.classSessionParticipant.sessionId, sessionId));

    const peerIds = peers.map((p) => p.studentId);
    if (peerIds.length === 0) return { items: [] };

    const showcases = await db
      .select({
        id: schema.showcase.id,
        studentId: schema.showcase.studentId,
        title: schema.showcase.title,
        visibility: schema.showcase.visibility,
        createdAt: schema.showcase.createdAt,
        artifactId: schema.showcase.artifactId,
        content: schema.artifact.contentJson,
        displayName: schema.student.displayName,
        avatarKey: schema.student.avatarKey,
        avatarStage: schema.student.avatarStage,
      })
      .from(schema.showcase)
      .innerJoin(schema.student, eq(schema.student.id, schema.showcase.studentId))
      .leftJoin(schema.artifact, eq(schema.artifact.id, schema.showcase.artifactId))
      .where(inArray(schema.showcase.studentId, peerIds))
      .orderBy(desc(schema.showcase.createdAt));

    const visible: typeof showcases = [];
    for (const item of showcases) {
      const scopes = await visibleScopesFor(req.viewer!, item.studentId);
      if (scopes.has(item.visibility as never)) visible.push(item);
    }

    const ids = visible.map((v) => v.id);
    const notes = ids.length
      ? await db
          .select({
            id: schema.peerNote.id,
            showcaseId: schema.peerNote.showcaseId,
            noteType: schema.peerNote.noteType,
            content: schema.peerNote.content,
            fromName: schema.student.displayName,
          })
          .from(schema.peerNote)
          .innerJoin(schema.student, eq(schema.student.id, schema.peerNote.fromStudentId))
          .where(
            and(
              inArray(schema.peerNote.showcaseId, ids),
              eq(schema.peerNote.reviewState, 'APPROVED'),
            ),
          )
      : [];

    return {
      items: visible.map((v) => ({
        id: v.id,
        title: v.title,
        visibility: v.visibility,
        createdAt: v.createdAt.toISOString(),
        content: v.content,
        displayName: v.displayName,
        avatarKey: v.avatarKey,
        avatarStage: v.avatarStage,
        isMine: v.studentId === req.viewer!.id,
        notes: notes
          .filter((n) => n.showcaseId === v.id)
          .map((n) => ({
            id: n.id,
            noteType: n.noteType,
            content: n.content,
            fromName: n.fromName,
          })),
      })),
    };
  });

  /* ── 给同伴留正向留言（三类句式）────────────────────── */

  app.post('/api/student/notes', { preHandler: requireStudent }, async (req, reply) => {
    const body = z
      .object({
        showcaseId: z.string().min(1),
        noteType: z.enum(NOTE_TYPES),
        content: z.string().min(1).max(200),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: '只能写「我注意到…」「我喜欢…」「我想问…」这三种',
      });
    }

    const showcases = await db
      .select()
      .from(schema.showcase)
      .where(eq(schema.showcase.id, body.data.showcaseId))
      .limit(1);
    const showcase = showcases[0];
    if (!showcase) throw new NotFoundError();

    // 不能给自己的作品留言
    if (showcase.studentId === req.viewer!.id) {
      return reply.code(400).send({ error: 'SELF_NOTE', message: '这是你自己的展位呀' });
    }

    // 留言者必须能看到这件作品
    const scopes = await visibleScopesFor(req.viewer!, showcase.studentId);
    if (!scopes.has(showcase.visibility as never)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个内容' });
    }

    // 句子必须以对应的句式开头
    const prefix = `我${body.data.noteType}`;
    if (!body.data.content.startsWith(prefix)) {
      return reply.code(400).send({
        error: 'BAD_PHRASE',
        message: `要从「${prefix}…」开始写哦`,
      });
    }

    const id = `pn_${crypto.randomUUID()}`;
    await db.insert(schema.peerNote).values({
      id,
      showcaseId: showcase.id,
      fromStudentId: req.viewer!.id,
      noteType: body.data.noteType,
      content: body.data.content,
      // 先审后放只针对跨期留言（Q5 待拍板的是 VIS_L2 的开放度）：
      // 同班（VIS_L1）是课堂内当场发生的同伴互评，直接放行；
      // 跨期与对外的留言默认 PENDING，等老师放行。
      reviewState: showcase.visibility === 'VIS_L1' ? 'APPROVED' : 'PENDING',
    });
    return reply.code(201).send({ id });
  });
}
