/**
 * 课堂会话路由 —— 讲师驾驶舱的全部行为
 *
 * 硬约束：
 *  C5  class_session 指向当时的教案版本快照；改细案不影响往期记录
 *  C6  讲师单节录入 ≤3 次点击：环节实耗由时间轴切换自动算出，
 *      开口次数用点击代替画正字，任务单完成率由插件回传
 *  C9  课堂码是会话凭证，不产生长期身份；下课时立即失效
 */

import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../db/driver.js';
import { requireStaff } from '../../middleware/guards.js';
import { cacheKeys, getCache } from '../../lib/cache.js';
import { generateClassCode, issueToken } from '../../lib/auth.js';
import { CLASS_CODE_TTL_SECONDS } from '../../env.js';
import {
  DEFAULT_PHASE_MINUTES,
  PHASES,
  coerceResultPayload,
  isVisibilityScope,
  type Phase,
  type VisibilityScope,
  type ResultFieldType,
} from '@dreamcity/shared';

/** 采集按钮 —— 只点不填 */
const CAPTURE_KINDS = ['完成', '卡住', '已单独问过'] as const;
type CaptureKind = (typeof CAPTURE_KINDS)[number];

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  /* ─────────────────────────────────────────────────────
   * 建课：生成草稿 + 冻结教案版本快照（C5）
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions', { preHandler: requireStaff }, async (req, reply) => {
    const body = z
      .object({
        lessonId: z.string().min(1),
        roomName: z.string().min(1),
        participantCount: z.number().int().min(2),
        termId: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'BAD_REQUEST',
        message: '班型下限是 2 人（不设计 1 对 1）',
      });
    }

    const lessons = await db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.id, body.data.lessonId))
      .limit(1);
    const lesson = lessons[0];
    if (!lesson) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这节课' });

    const versions = await db
      .select()
      .from(schema.lessonPlanVersion)
      .where(eq(schema.lessonPlanVersion.lessonId, lesson.id))
      .orderBy(desc(schema.lessonPlanVersion.version))
      .limit(1);
    const version = versions[0];
    if (!version) {
      return reply.code(409).send({ error: 'NO_PLAN', message: '这节课还没有教案版本' });
    }

    const sessionId = `ses_${crypto.randomUUID()}`;
    await db.insert(schema.classSession).values({
      id: sessionId,
      lessonId: lesson.id,
      planVersionId: version.id,
      termId: body.data.termId ?? null,
      teacherId: req.viewer!.id,
      roomName: body.data.roomName,
      participantCount: body.data.participantCount,
      classType: 'SMALL_GROUP',
      state: 'DRAFT',
    });

    // 课堂名单：把该期次在读的孩子拉进来
    const roster = await resolveRoster(body.data.termId, lesson.levelId);
    for (const studentId of roster) {
      await db
        .insert(schema.classSessionParticipant)
        .values({ id: `csp_${crypto.randomUUID()}`, sessionId, studentId })
        .onConflictDoNothing();
    }

    return reply.code(201).send({ id: sessionId, rosterSize: roster.length });
  });

  /* ─────────────────────────────────────────────────────
   * 名单点名：开课前/课中把学员加进这一班
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/participants', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z.object({ studentId: z.string().min(1) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    }
    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    const students = await db
      .select()
      .from(schema.student)
      .where(eq(schema.student.id, body.data.studentId))
      .limit(1);
    const student = students[0];
    if (!student) return reply.code(404).send({ error: 'NOT_FOUND', message: '名册里没有这个孩子' });
    if (student.state !== 'ACTIVE') {
      return reply.code(400).send({ error: 'INACTIVE', message: '这个孩子已停用，先和家长确认一下' });
    }

    await db
      .insert(schema.classSessionParticipant)
      .values({
        id: `csp_${crypto.randomUUID()}`,
        sessionId: session.id,
        studentId: student.id,
        joinedAt: new Date(),
      })
      .onConflictDoNothing();

    // 人数上限跟着 session 走
    const count = await db
      .select({ id: schema.classSessionParticipant.id })
      .from(schema.classSessionParticipant)
      .where(eq(schema.classSessionParticipant.sessionId, session.id));
    await db
      .update(schema.classSession)
      .set({ participantCount: Math.max(count.length, session.participantCount) })
      .where(eq(schema.classSession.id, session.id));

    return reply.code(201).send({ ok: true, studentId: student.id });
  });

  app.delete('/api/sessions/:id/participants/:studentId', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string(), studentId: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });

    await db
      .delete(schema.classSessionParticipant)
      .where(
        and(
          eq(schema.classSessionParticipant.sessionId, params.data.id),
          eq(schema.classSessionParticipant.studentId, params.data.studentId),
        ),
      );

    const count = await db
      .select({ id: schema.classSessionParticipant.id })
      .from(schema.classSessionParticipant)
      .where(eq(schema.classSessionParticipant.sessionId, params.data.id));
    await db
      .update(schema.classSession)
      .set({ participantCount: count.length })
      .where(eq(schema.classSession.id, params.data.id));

    return { ok: true };
  });

  /* ─────────────────────────────────────────────────────
   * 会话列表
   * ───────────────────────────────────────────────────── */

  app.get('/api/sessions', { preHandler: requireStaff }, async (req) => {
    const rows = await db
      .select({
        id: schema.classSession.id,
        lessonId: schema.classSession.lessonId,
        lessonTitle: schema.lesson.title,
        levelId: schema.lesson.levelId,
        state: schema.classSession.state,
        classCode: schema.classSession.classCode,
        participantCount: schema.classSession.participantCount,
        startedAt: schema.classSession.startedAt,
        endedAt: schema.classSession.endedAt,
      })
      .from(schema.classSession)
      .innerJoin(schema.lesson, eq(schema.lesson.id, schema.classSession.lessonId))
      .orderBy(desc(schema.classSession.createdAt))
      .limit(100);
    return rows.map((r) => ({
      ...r,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
    }));
  });

  /* ─────────────────────────────────────────────────────
   * 开课：生成 6 位课堂码
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/open', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '会话编号不对' });

    const sessions = await db
      .select()
      .from(schema.classSession)
      .where(eq(schema.classSession.id, params.data.id))
      .limit(1);
    const session = sessions[0];
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });
    if (session.state === 'CLOSED') {
      return reply.code(409).send({ error: 'SESSION_CLOSED', message: '这次课已经结课了' });
    }

    const cache = await getCache();
    let code: string | null = session.classCode;
    if (!code || !(await cache.get(cacheKeys.classCode(code)))) {
      // 6 位数字，2 小时过期；单码只绑一个 session
      for (let i = 0; i < 20; i += 1) {
        const candidate = generateClassCode();
        const taken = await cache.get(cacheKeys.classCode(candidate));
        if (!taken) {
          code = candidate;
          break;
        }
      }
      if (!code) {
        return reply.code(500).send({ error: 'CODE_GEN_FAILED', message: '课堂码生成失败，再试一次' });
      }
      await cache.set(cacheKeys.classCode(code), session.id, CLASS_CODE_TTL_SECONDS);
    }

    const startedAt = new Date();
    await db
      .update(schema.classSession)
      .set({ state: 'LIVE', classCode: code, startedAt: session.startedAt ?? startedAt })
      .where(eq(schema.classSession.id, session.id));

    return { classCode: code, startedAt: startedAt.toISOString() };
  });

  /* ─────────────────────────────────────────────────────
   * 编排：整份替换活动序列
   * ───────────────────────────────────────────────────── */

  app.put('/api/sessions/:id/activities', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({
        activities: z.array(
          z.object({
            phase: z.enum(PHASES),
            modeCard: z.string().nullable().optional(),
            atom: z.string().nullable().optional(),
            title: z.string().min(1),
            durationMin: z.number().int().min(1).max(60),
            pluginId: z.string().nullable().optional(),
            resourceId: z.string().nullable().optional(),
            activityKind: z.enum(['LESSON_PDF', 'PLUGIN', 'VOTE', 'TASK', 'SUBMIT', 'BREAK']),
          }),
        ),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '编排内容不完整' });
    }

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    await db.delete(schema.sessionActivity).where(eq(schema.sessionActivity.sessionId, session.id));
    let seq = 0;
    for (const a of body.data.activities) {
      seq += 1;
      await db.insert(schema.sessionActivity).values({
        id: `sa_${crypto.randomUUID()}`,
        sessionId: session.id,
        seq,
        phase: a.phase,
        modeCard: a.modeCard ?? null,
        atom: a.atom ?? null,
        title: a.title,
        durationMin: a.durationMin,
        pluginId: a.pluginId ?? null,
        resourceId: a.resourceId ?? null,
        activityKind: a.activityKind,
      });
    }
    return { count: seq };
  });

  /* ─────────────────────────────────────────────────────
   * 驾驶舱状态（一屏三区的数据源）
   * ───────────────────────────────────────────────────── */

  app.get('/api/sessions/:id/cockpit', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '会话编号不对' });

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    const lessons = await db
      .select({ title: schema.lesson.title })
      .from(schema.lesson)
      .where(eq(schema.lesson.id, session.lessonId))
      .limit(1);

    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, session.id))
      .orderBy(asc(schema.sessionActivity.seq));

    const records = await db
      .select()
      .from(schema.sessionRecord)
      .where(eq(schema.sessionRecord.sessionId, session.id))
      .orderBy(asc(schema.sessionRecord.occurredAt));

    const participants = await db
      .select({
        studentId: schema.student.id,
        displayName: schema.student.displayName,
        avatarKey: schema.student.avatarKey,
        avatarStage: schema.student.avatarStage,
        joinedAt: schema.classSessionParticipant.joinedAt,
      })
      .from(schema.classSessionParticipant)
      .innerJoin(schema.student, eq(schema.student.id, schema.classSessionParticipant.studentId))
      .where(eq(schema.classSessionParticipant.sessionId, session.id));

    const observations = await db
      .select()
      .from(schema.observation)
      .where(eq(schema.observation.sessionId, session.id));

    // 环节实耗：从 PHASE_START / PHASE_END 事件算出来，讲师不用录
    const phases = buildPhaseTimings(session.startedAt, records, activities);

    const currentActivityId =
      activities.find((a) => {
        const start = records.find(
          (r) => r.recordType === 'ACTIVITY_LAUNCH' && r.sessionActivityId === a.id,
        );
        const end = records.find(
          (r) => r.recordType === 'ACTIVITY_RESULT' && r.sessionActivityId === a.id,
        );
        return start && !end;
      })?.id ?? null;

    const currentActivity = activities.find((a) => a.id === currentActivityId);
    let offlineFallback: string | null = null;
    if (currentActivity?.pluginId) {
      const plugins = await db
        .select()
        .from(schema.activityPlugin)
        .where(eq(schema.activityPlugin.id, currentActivity.pluginId))
        .limit(1);
      const manifest = plugins[0]?.manifestJson as { offline_fallback?: string } | undefined;
      offlineFallback = manifest?.offline_fallback ?? null;
    }

    const elapsedMin = session.startedAt
      ? Math.floor((Date.now() - session.startedAt.getTime()) / 60000)
      : 0;

    return {
      sessionId: session.id,
      lessonId: session.lessonId,
      lessonTitle: lessons[0]?.title ?? '',
      state: session.state,
      classCode: session.classCode,
      startedAt: session.startedAt?.toISOString() ?? null,
      elapsedMin,
      participantCount: participants.length,
      phases,
      activities: activities.map((a) => ({
        id: a.id,
        seq: a.seq,
        phase: a.phase,
        modeCard: a.modeCard,
        atom: a.atom,
        title: a.title,
        durationMin: a.durationMin,
        pluginId: a.pluginId,
        resourceId: a.resourceId,
        activityKind: a.activityKind,
      })),
      participants: participants.map((p) => ({
        studentId: p.studentId,
        displayName: p.displayName,
        avatarKey: p.avatarKey,
        avatarStage: p.avatarStage,
        askedCount: observations.find((o) => o.studentId === p.studentId)?.patrolCount ?? 0,
        joinedAt: p.joinedAt?.toISOString() ?? null,
      })),
      currentActivityId,
      offlineFallback,
    };
  });

  /* ─────────────────────────────────────────────────────
   * 环节推进：点一下即计时（自动累计实耗）
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/phases/:phase/start', { preHandler: requireStaff }, async (req, reply) => {
    const params = z
      .object({ id: z.string(), phase: z.enum(PHASES) })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '环节名不对' });

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    await db.insert(schema.sessionRecord).values({
      id: `sr_${crypto.randomUUID()}`,
      sessionId: session.id,
      recordType: 'PHASE_START',
      eventJson: { phase: params.data.phase, at: new Date().toISOString() },
    });
    return { ok: true, phase: params.data.phase };
  });

  app.post('/api/sessions/:id/phases/:phase/end', { preHandler: requireStaff }, async (req, reply) => {
    const params = z
      .object({ id: z.string(), phase: z.enum(PHASES) })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '环节名不对' });

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    // 找最近一次该环节的 PHASE_START，算出实耗
    const records = await db
      .select()
      .from(schema.sessionRecord)
      .where(
        and(
          eq(schema.sessionRecord.sessionId, session.id),
          eq(sql`${schema.sessionRecord.eventJson}->>'phase'`, params.data.phase),
        ),
      )
      .orderBy(desc(schema.sessionRecord.occurredAt));

    const start = records.find((r) => r.recordType === 'PHASE_START');
    const actualMin = start
      ? Math.max(0, Math.round(((Date.now() - start.occurredAt.getTime()) / 60000) * 10) / 10)
      : null;

    await db.insert(schema.sessionRecord).values({
      id: `sr_${crypto.randomUUID()}`,
      sessionId: session.id,
      recordType: 'PHASE_END',
      actualMin: actualMin === null ? null : String(actualMin),
      eventJson: { phase: params.data.phase, at: new Date().toISOString() },
    });
    return { ok: true, phase: params.data.phase, actualMin };
  });

  /* ─────────────────────────────────────────────────────
   * 三键采集 —— 讲师全程手工录入的主要动作
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/captures', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({ studentId: z.string().min(1), kind: z.enum(CAPTURE_KINDS) })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '采集内容不完整' });
    }

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    // 当前环节（自动带上，不让讲师填）
    const openPhase = await currentPhase(session.id);

    await db.insert(schema.sessionRecord).values({
      id: `sr_${crypto.randomUUID()}`,
      sessionId: session.id,
      recordType: 'CAPTURE',
      studentId: body.data.studentId,
      eventJson: { kind: body.data.kind, phase: openPhase, at: new Date().toISOString() },
    });

    // 六指标落库
    const existing = await db
      .select()
      .from(schema.observation)
      .where(
        and(
          eq(schema.observation.sessionId, session.id),
          eq(schema.observation.studentId, body.data.studentId),
        ),
      )
      .limit(1);
    const obs = existing[0];
    const kind = body.data.kind as CaptureKind;

    if (!obs) {
      await db.insert(schema.observation).values({
        id: `obs_${crypto.randomUUID()}`,
        sessionId: session.id,
        studentId: body.data.studentId,
        speakCount: 0,
        patrolCount: kind === '已单独问过' ? 1 : 0,
        stuckCount: kind === '卡住' ? 1 : 0,
        taskCompletion: null,
      });
    } else {
      await db
        .update(schema.observation)
        .set({
          speakCount: obs.speakCount + (kind === '完成' ? 1 : 0),
          patrolCount: obs.patrolCount + (kind === '已单独问过' ? 1 : 0),
          stuckCount: obs.stuckCount + (kind === '卡住' ? 1 : 0),
          capturedAt: new Date(),
        })
        .where(eq(schema.observation.id, obs.id));
    }

    return { ok: true, phase: openPhase };
  });

  /* ─────────────────────────────────────────────────────
   * 拉起活动
   * ───────────────────────────────────────────────────── */

  app.post(
    '/api/sessions/:id/activities/:activityId/launch',
    { preHandler: requireStaff },
    async (req, reply) => {
      const params = z
        .object({ id: z.string(), activityId: z.string() })
        .safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
      }
      const session = await loadSession(params.data.id);
      if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

      const activities = await db
        .select()
        .from(schema.sessionActivity)
        .where(
          and(
            eq(schema.sessionActivity.sessionId, session.id),
            eq(schema.sessionActivity.id, params.data.activityId),
          ),
        )
        .limit(1);
      const activity = activities[0];
      if (!activity) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这个活动' });

      await db.insert(schema.sessionRecord).values({
        id: `sr_${crypto.randomUUID()}`,
        sessionId: session.id,
        sessionActivityId: activity.id,
        recordType: 'ACTIVITY_LAUNCH',
        eventJson: { at: new Date().toISOString() },
      });

      let entry: string | null = null;
      if (activity.pluginId) {
        const plugins = await db
          .select()
          .from(schema.activityPlugin)
          .where(eq(schema.activityPlugin.id, activity.pluginId))
          .limit(1);
        entry = plugins[0]?.entry ?? null;
      }

      return {
        ok: true,
        activityId: activity.id,
        entry,
        activityKind: activity.activityKind,
        resourceId: activity.resourceId,
      };
    },
  );

  /* ─────────────────────────────────────────────────────
   * 插件结果回传 —— 课堂沉淀成资产的那一步
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/results', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({
        activityId: z.string().min(1),
        studentId: z.string().nullable().optional(),
        payload: z.record(z.string(), z.unknown()),
        visibility: z.string().optional(),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '结果格式不对' });
    }

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    // 校验 activityId 命中本次 session 的编排
    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, session.id),
          eq(schema.sessionActivity.id, body.data.activityId),
        ),
      )
      .limit(1);
    const activity = activities[0];
    if (!activity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: '这个活动不属于这次课' });
    }

    type PluginManifest = {
      id: string;
      result_schema: Record<string, ResultFieldType>;
      artifact_fields: string[];
      result_optional?: string[];
    };
    let manifest: PluginManifest | null = null;
    if (activity.pluginId) {
      const plugins = await db
        .select()
        .from(schema.activityPlugin)
        .where(eq(schema.activityPlugin.id, activity.pluginId))
        .limit(1);
      manifest = (plugins[0]?.manifestJson ?? null) as PluginManifest | null;
    }
    if (!manifest) {
      return reply.code(400).send({ error: 'NO_MANIFEST', message: '这个活动没有登记 manifest' });
    }

    // 结果必须可序列化且符合 result_schema（插件硬约束 2）
    const coerced = coerceResultPayload(
      body.data.payload,
      manifest.result_schema,
      manifest.result_optional ?? [],
    );
    if (!coerced.ok) {
      return reply.code(400).send({
        error: 'INVALID_PAYLOAD',
        message: '活动回传的结果不符合约定格式',
        issues: coerced.issues,
      });
    }

    const studentId = body.data.studentId ?? null;
    const visibility: VisibilityScope = isVisibilityScope(body.data.visibility)
      ? body.data.visibility
      : 'VIS_L0';

    await db.insert(schema.sessionRecord).values({
      id: `sr_${crypto.randomUUID()}`,
      sessionId: session.id,
      sessionActivityId: activity.id,
      recordType: 'ACTIVITY_RESULT',
      studentId,
      eventJson: { payload: coerced.value, visibility, at: new Date().toISOString() },
    });

    // 按 artifact_fields 生成作品
    let artifactId: string | null = null;
    if (studentId && manifest.artifact_fields.length > 0) {
      const content: Record<string, unknown> = {};
      for (const f of manifest.artifact_fields) {
        content[f] = coerced.value[f] ?? null;
      }
      artifactId = `art_${crypto.randomUUID()}`;
      await db.insert(schema.artifact).values({
        id: artifactId,
        sessionId: session.id,
        studentId,
        lessonId: session.lessonId,
        artifactType: '作品',
        title: activity.title,
        contentJson: content,
        visibility,
        wallApproved: false,
      });

      // 作品进入展位（人人有份，按时间排序）
      await db.insert(schema.showcase).values({
        id: `sc_${crypto.randomUUID()}`,
        studentId,
        sessionId: session.id,
        artifactId,
        title: activity.title,
        visibility,
        wallApproved: false,
      });
    }

    // 任务单完成率由插件回传 → 写进 observation
    if (studentId && typeof coerced.value.task_completion === 'number') {
      const obs = await db
        .select()
        .from(schema.observation)
        .where(
          and(
            eq(schema.observation.sessionId, session.id),
            eq(schema.observation.studentId, studentId),
          ),
        )
        .limit(1);
      const completion = Math.max(0, Math.min(1, coerced.value.task_completion));
      if (obs[0]) {
        await db
          .update(schema.observation)
          .set({ taskCompletion: String(completion), capturedAt: new Date() })
          .where(eq(schema.observation.id, obs[0].id));
      } else {
        await db.insert(schema.observation).values({
          id: `obs_${crypto.randomUUID()}`,
          sessionId: session.id,
          studentId,
          speakCount: 0,
          patrolCount: 0,
          stuckCount: 0,
          taskCompletion: String(completion),
        });
      }
    }

    return { ok: true, artifactId };
  });

  /* ─────────────────────────────────────────────────────
   * 结课
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/close', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '会话编号不对' });

    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });

    const endedAt = new Date();
    await db
      .update(schema.classSession)
      .set({ state: 'CLOSED', endedAt })
      .where(eq(schema.classSession.id, session.id));

    // 课堂码立即失效（C9）
    const cache = await getCache();
    if (session.classCode) {
      await cache.del(cacheKeys.classCode(session.classCode));
    }

    // 环节实耗汇总
    const records = await db
      .select()
      .from(schema.sessionRecord)
      .where(eq(schema.sessionRecord.sessionId, session.id));
    const totalActualMin = records
      .filter((r) => r.recordType === 'PHASE_END')
      .reduce((sum, r) => sum + Number(r.actualMin ?? 0), 0);

    const artifacts = await db
      .select({ id: schema.artifact.id })
      .from(schema.artifact)
      .where(eq(schema.artifact.sessionId, session.id));

    const lessons = await db
      .select({ title: schema.lesson.title })
      .from(schema.lesson)
      .where(eq(schema.lesson.id, session.lessonId))
      .limit(1);

    // 结课摘要草稿（讲师一键确认后发家长）
    const artifactsByStudent = await db
      .select({ studentId: schema.artifact.studentId, title: schema.artifact.title })
      .from(schema.artifact)
      .where(eq(schema.artifact.sessionId, session.id));
    const draft = buildSummaryDraft(lessons[0]?.title ?? '', artifactsByStudent.length);

    return {
      sessionId: session.id,
      lessonTitle: lessons[0]?.title ?? '',
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: endedAt.toISOString(),
      totalActualMin: Math.round(totalActualMin * 10) / 10,
      artifactCount: artifacts.length,
      participants: session.participantCount,
      draft,
    };
  });

  /* ─────────────────────────────────────────────────────
   * 讲师进入课堂的临时令牌（供投屏机 / 助教端使用）
   * ───────────────────────────────────────────────────── */

  app.post('/api/sessions/:id/staff-token', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '会话编号不对' });
    const session = await loadSession(params.data.id);
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这次课' });
    const token = issueToken({ sub: req.viewer!.id, role: 'staff', sid: session.id });
    return { token };
  });
}

/* ══════════════════════════════════════════════════════════
 * 辅助函数
 * ══════════════════════════════════════════════════════════ */

async function loadSession(sessionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.classSession)
    .where(eq(schema.classSession.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

/** 课堂名单：优先取该期次在读的孩子；没有期次时取同级别的在读孩子 */
async function resolveRoster(termId: string | undefined, levelId: string): Promise<string[]> {
  const db = getDb();
  if (termId) {
    const rows = await db
      .selectDistinct({ studentId: schema.enrollment.studentId })
      .from(schema.enrollment)
      .where(eq(schema.enrollment.termId, termId));
    return rows.map((r) => r.studentId);
  }
  const rows = await db
    .selectDistinct({ studentId: schema.student.id })
    .from(schema.student)
    .where(eq(schema.student.levelId, levelId));
  return rows.map((r) => r.studentId);
}

async function currentPhase(sessionId: string): Promise<Phase | null> {
  const db = getDb();
  const records = await db
    .select()
    .from(schema.sessionRecord)
    .where(eq(schema.sessionRecord.sessionId, sessionId))
    .orderBy(desc(schema.sessionRecord.occurredAt))
    .limit(20);
  for (const r of records) {
    if (r.recordType === 'PHASE_START') {
      return ((r.eventJson as { phase?: Phase }).phase ?? null) as Phase | null;
    }
    if (r.recordType === 'PHASE_END') continue;
  }
  return null;
}

/**
 * 环节时间轴：计划时长来自编排，实耗由 PHASE_START/PHASE_END 自动算出。
 */
function buildPhaseTimings(
  startedAt: Date | null,
  records: { recordType: string; actualMin: string | null; eventJson: Record<string, unknown>; occurredAt: Date }[],
  activities: { phase: string; durationMin: number }[],
): { phase: Phase; plannedMin: number; actualMin: number; startedAt: string | null; endedAt: string | null; isCurrent: boolean }[] {
  const planned = new Map<Phase, number>();
  for (const a of activities) {
    const phase = a.phase as Phase;
    planned.set(phase, (planned.get(phase) ?? 0) + a.durationMin);
  }
  if (planned.size === 0) {
    for (const p of PHASES) planned.set(p, DEFAULT_PHASE_MINUTES[p]);
  }

  const actual = new Map<Phase, number>();
  const actualSec = new Map<Phase, number>();
  const starts = new Map<Phase, string>();
  const ends = new Map<Phase, string>();
  const open = new Set<Phase>();

  for (const r of records) {
    const phase = (r.eventJson as { phase?: Phase }).phase;
    if (!phase) continue;
    if (r.recordType === 'PHASE_START') {
      if (!starts.has(phase)) starts.set(phase, r.occurredAt.toISOString());
      open.add(phase);
    }
    if (r.recordType === 'PHASE_END') {
      const min = Number(r.actualMin ?? 0);
      actual.set(phase, (actual.get(phase) ?? 0) + min);
      actualSec.set(phase, (actualSec.get(phase) ?? 0) + min * 60);
      ends.set(phase, r.occurredAt.toISOString());
      open.delete(phase);
    }
  }

  // 正在进行中的环节：实耗按现在算
  const now = Date.now();
  for (const phase of open) {
    const started = starts.get(phase);
    if (started) {
      const extraSec = Math.max(0, (now - new Date(started).getTime()) / 1000);
      actual.set(phase, (actual.get(phase) ?? 0) + extraSec / 60);
      actualSec.set(phase, (actualSec.get(phase) ?? 0) + extraSec);
    }
  }

  return PHASES.map((phase) => {
    const sec = Math.round(actualSec.get(phase) ?? 0);
    return {
      phase,
      plannedMin: planned.get(phase) ?? DEFAULT_PHASE_MINUTES[phase],
      actualMin: Math.round((sec / 60) * 10) / 10,
      actualSec: sec,
      startedAt: starts.get(phase) ?? null,
      endedAt: ends.get(phase) ?? null,
      isCurrent: open.has(phase),
    };
  });
}

function buildSummaryDraft(lessonTitle: string, artifactCount: number): string {
  const parts = [`今天上了《${lessonTitle}》。`];
  if (artifactCount > 0) {
    parts.push(`孩子完成了 ${artifactCount} 件产出，都已经放进成长档案了。`);
  } else {
    parts.push('今天以讲解和互动为主，作品会在下一次实操课产出。');
  }
  parts.push('想看孩子的作品，在下面的时间线里就能看到。');
  return parts.join('');
}
