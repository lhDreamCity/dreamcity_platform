/**
 * 内容路由 —— 课次库 / 教案版本 / 插件库
 *
 * 课次与细案原文入库；教案修订生成新版本，不覆盖旧版（C5）。
 */

import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../db/driver.js';
import { requireStaff } from '../../middleware/guards.js';
import { validateManifest } from '@dreamcity/shared';
import { GRADE_META, isGradeLevel, type GradeLevel } from '@dreamcity/shared';

export async function registerContentRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  /* ── 级别 ────────────────────────────────────────────── */

  app.get('/api/levels', { preHandler: requireStaff }, async () => {
    const rows = await db.select().from(schema.level).orderBy(asc(schema.level.seq));
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      gradeRange: r.gradeRange,
      theme: r.theme,
      seq: r.seq,
    }));
  });

  /* ── 单元 ────────────────────────────────────────────── */

  app.get('/api/units', { preHandler: requireStaff }, async (req) => {
    const query = z.object({ level: z.string().optional() }).safeParse(req.query);
    const levelId = query.success ? query.data.level : undefined;
    const rows = levelId
      ? await db
          .select()
          .from(schema.unit)
          .where(eq(schema.unit.levelId, levelId))
          .orderBy(asc(schema.unit.seq))
      : await db.select().from(schema.unit).orderBy(asc(schema.unit.levelId), asc(schema.unit.seq));
    return rows;
  });

  /* ── 课次库 ──────────────────────────────────────────── */

  app.get('/api/lessons', { preHandler: requireStaff }, async (req) => {
    const query = z
      .object({ level: z.string().optional(), q: z.string().optional() })
      .safeParse(req.query);
    const level = query.success && isGradeLevel(query.data.level) ? query.data.level : undefined;
    const keyword = query.success ? (query.data.q ?? '').trim() : '';

    const rows = await db
      .select({
        id: schema.lesson.id,
        unitId: schema.lesson.unitId,
        levelId: schema.lesson.levelId,
        seq: schema.lesson.seq,
        title: schema.lesson.title,
        output: schema.lesson.output,
        defaultRecipe: schema.lesson.defaultRecipe,
        currentVersionId: schema.lesson.currentVersionId,
      })
      .from(schema.lesson)
      .orderBy(asc(schema.lesson.levelId), asc(schema.lesson.seq));

    const filtered = rows.filter((r) => {
      if (level && r.levelId !== level) return false;
      if (keyword && !`${r.id} ${r.title}`.includes(keyword)) return false;
      return true;
    });

    return filtered.map((r) => ({
      id: r.id,
      unitId: r.unitId,
      levelId: r.levelId,
      seq: r.seq,
      title: r.title,
      output: r.output,
      defaultRecipe: r.defaultRecipe,
      currentVersion: r.currentVersionId ? 1 : 0,
      gradeName: GRADE_META[r.levelId as GradeLevel]?.name ?? '',
    }));
  });

  /* ── 课次详情（含细案十字段）──────────────────────────── */

  app.get('/api/lessons/:id', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '课次编号不对' });

    const lessons = await db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.id, params.data.id))
      .limit(1);
    const lesson = lessons[0];
    if (!lesson) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这节课' });

    const versions = await db
      .select()
      .from(schema.lessonPlanVersion)
      .where(eq(schema.lessonPlanVersion.lessonId, lesson.id))
      .orderBy(desc(schema.lessonPlanVersion.version));

    const current = versions.find((v) => v.id === lesson.currentVersionId) ?? versions[0];
    const plan = (current?.contentJson ?? {}) as Record<string, unknown>;

    return {
      id: lesson.id,
      unitId: lesson.unitId,
      levelId: lesson.levelId,
      seq: lesson.seq,
      title: lesson.title,
      output: lesson.output,
      defaultRecipe: lesson.defaultRecipe,
      currentVersion: current?.version ?? 0,
      planVersionId: current?.id ?? null,
      plan,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        note: v.note,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  });

  /* ── 教案新版本（只增不改）────────────────────────────── */

  app.post('/api/lessons/:id/versions', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({
        contentJson: z.record(z.string(), z.unknown()),
        note: z.string().optional(),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '内容不完整' });
    }

    const lessons = await db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.id, params.data.id))
      .limit(1);
    const lesson = lessons[0];
    if (!lesson) return reply.code(404).send({ error: 'NOT_FOUND', message: '没找到这节课' });

    const existing = await db
      .select()
      .from(schema.lessonPlanVersion)
      .where(eq(schema.lessonPlanVersion.lessonId, lesson.id))
      .orderBy(desc(schema.lessonPlanVersion.version))
      .limit(1);
    const nextVersion = (existing[0]?.version ?? 0) + 1;
    const versionId = `lpv_${crypto.randomUUID()}`;

    await db.insert(schema.lessonPlanVersion).values({
      id: versionId,
      lessonId: lesson.id,
      version: nextVersion,
      contentJson: body.data.contentJson,
      note: body.data.note ?? null,
      createdBy: req.viewer?.id ?? null,
    });
    await db
      .update(schema.lesson)
      .set({ currentVersionId: versionId })
      .where(eq(schema.lesson.id, lesson.id));

    return reply.code(201).send({ id: versionId, version: nextVersion });
  });

  /* ── 插件库 ──────────────────────────────────────────── */

  app.get('/api/plugins', { preHandler: requireStaff }, async () => {
    const rows = await db.select().from(schema.activityPlugin).orderBy(asc(schema.activityPlugin.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      enabled: r.enabled,
      manifest: r.manifestJson,
    }));
  });

  /**
   * 注册插件：先跑 manifest 校验（设计方案 §5.1）。
   * 教研以后自己加课眼不用等研发排期 —— 校验通过即可上架。
   */
  app.post('/api/plugins', { preHandler: requireStaff }, async (req, reply) => {
    const body = z.record(z.string(), z.unknown()).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: 'manifest 格式不对' });
    }
    const result = validateManifest(body.data);
    if (!result.ok || !result.manifest) {
      return reply.code(400).send({
        error: 'INVALID_MANIFEST',
        message: 'manifest 没通过校验',
        issues: result.issues,
      });
    }
    const m = result.manifest;
    await db
      .insert(schema.activityPlugin)
      .values({
        id: m.id,
        name: m.name,
        version: m.version,
        entry: m.entry,
        manifestJson: m as unknown as Record<string, unknown>,
        resultSchema: m.result_schema as unknown as Record<string, unknown>,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: schema.activityPlugin.id,
        set: {
          name: m.name,
          version: m.version,
          entry: m.entry,
          manifestJson: m as unknown as Record<string, unknown>,
          resultSchema: m.result_schema as unknown as Record<string, unknown>,
        },
      });
    return reply.code(201).send({ id: m.id });
  });

  /** 某节课可用的插件 */
  app.get('/api/lessons/:id/plugins', { preHandler: requireStaff }, async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'BAD_REQUEST', message: '课次编号不对' });
    const rows = await db.select().from(schema.activityPlugin).orderBy(asc(schema.activityPlugin.name));
    const usable = rows.filter((r) => {
      const refs = (r.manifestJson as { lesson_refs?: string[] }).lesson_refs ?? [];
      return refs.length === 0 || refs.includes(params.data.id);
    });
    return usable.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      enabled: r.enabled,
      manifest: r.manifestJson,
    }));
  });

  /** 学员名册 —— 家长端添加孩子后，这里就会出现 */
  app.get('/api/students', { preHandler: requireStaff }, async (req) => {
    const query = z
      .object({ q: z.string().optional(), level: z.string().optional() })
      .safeParse(req.query);
    const keyword = (query.success ? query.data.q ?? '' : '').trim();
    const level = query.success && isGradeLevel(query.data.level) ? query.data.level : undefined;

    const rows = await db
      .select({
        id: schema.student.id,
        displayName: schema.student.displayName,
        avatarKey: schema.student.avatarKey,
        avatarStage: schema.student.avatarStage,
        grade: schema.student.grade,
        levelId: schema.student.levelId,
        state: schema.student.state,
        guardianId: schema.student.guardianId,
        guardianName: schema.guardian.name,
        guardianPhone: schema.guardian.phone,
      })
      .from(schema.student)
      .innerJoin(schema.guardian, eq(schema.guardian.id, schema.student.guardianId))
      .orderBy(asc(schema.student.grade), asc(schema.student.displayName));

    const participantRows = await db
      .selectDistinct({ studentId: schema.classSessionParticipant.studentId })
      .from(schema.classSessionParticipant);
    const inSomeClass = new Set(participantRows.map((r) => r.studentId));

    return rows
      .filter((r) => {
        if (level && r.levelId !== level) return false;
        if (!keyword) return true;
        const hay = `${r.displayName} ${r.guardianName} ${r.guardianPhone.slice(-4)}`;
        return hay.includes(keyword);
      })
      .map((r) => ({
        id: r.id,
        displayName: r.displayName,
        avatarKey: r.avatarKey,
        avatarStage: r.avatarStage,
        grade: r.grade,
        levelId: r.levelId,
        state: r.state,
        guardianName: r.guardianName,
        phoneTail: r.guardianPhone.slice(-4),
        inSession: inSomeClass.has(r.id),
      }));
  });

  /** 模式卡与原子字典（编排器用） */
  app.get('/api/lesson-lexicon', { preHandler: requireStaff }, async () => {
    const { MODE_META, ATOM_META, PHASES, DEFAULT_PHASE_MINUTES, RECIPE_TEMPLATES } = await import(
      '@dreamcity/shared'
    );
    return {
      modes: Object.values(MODE_META),
      atoms: Object.values(ATOM_META),
      phases: PHASES,
      defaultPhaseMinutes: DEFAULT_PHASE_MINUTES,
      recipes: Object.values(RECIPE_TEMPLATES),
    };
  });
}
