/**
 * 运营后台 —— 轻量视图
 * V1 期间后台只保留最小页 + 表格（设计方案 §3.4 O5）。
 */

import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/driver.js';
import { requireStaff } from '../../middleware/guards.js';

export async function registerOpsRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  app.get('/api/ops/overview', { preHandler: requireStaff }, async () => {
    const [students, guardians, sessions, artifacts, notes] = await Promise.all([
      db.select({ id: schema.student.id }).from(schema.student),
      db.select({ id: schema.guardian.id }).from(schema.guardian),
      db.select({ id: schema.classSession.id, state: schema.classSession.state }).from(schema.classSession),
      db.select({ id: schema.artifact.id }).from(schema.artifact),
      db.select({ id: schema.peerNote.id, reviewState: schema.peerNote.reviewState }).from(schema.peerNote),
    ]);

    return {
      students: students.length,
      guardians: guardians.length,
      sessions: sessions.length,
      liveSessions: sessions.filter((s) => s.state === 'LIVE').length,
      artifacts: artifacts.length,
      pendingNotes: notes.filter((n) => n.reviewState === 'PENDING').length,
    };
  });

  /** 留言审核队列（跨期留言是否先审后放 —— Q5 待拍板，接口先就位） */
  app.get('/api/ops/notes', { preHandler: requireStaff }, async (req) => {
    const query = (req.query as { state?: string }) ?? {};
    const state = query.state ?? 'PENDING';
    const rows = await db
      .select({
        id: schema.peerNote.id,
        noteType: schema.peerNote.noteType,
        content: schema.peerNote.content,
        reviewState: schema.peerNote.reviewState,
        createdAt: schema.peerNote.createdAt,
        fromName: schema.student.displayName,
        showcaseTitle: schema.showcase.title,
        studentId: schema.showcase.studentId,
      })
      .from(schema.peerNote)
      .innerJoin(schema.student, eq(schema.student.id, schema.peerNote.fromStudentId))
      .innerJoin(schema.showcase, eq(schema.showcase.id, schema.peerNote.showcaseId))
      .where(eq(schema.peerNote.reviewState, state))
      .orderBy(desc(schema.peerNote.createdAt));
    return rows.map((r) => ({
      id: r.id,
      noteType: r.noteType,
      content: r.content,
      reviewState: r.reviewState,
      createdAt: r.createdAt.toISOString(),
      fromName: r.fromName,
      showcaseTitle: r.showcaseTitle,
      studentId: r.studentId,
    }));
  });

  app.post('/api/ops/notes/:id/review', { preHandler: requireStaff }, async (req, reply) => {
    const params = (req.params as { id?: string }) ?? {};
    const body = (req.body as { approve?: boolean }) ?? {};
    if (!params.id) return reply.code(400).send({ error: 'BAD_REQUEST', message: '参数不对' });
    await db
      .update(schema.peerNote)
      .set({ reviewState: body.approve ? 'APPROVED' : 'REJECTED' })
      .where(eq(schema.peerNote.id, params.id));
    return { ok: true };
  });
}
