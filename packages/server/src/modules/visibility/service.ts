/**
 * 可见性服务 —— 硬约束 C7 的落点
 *
 * 「可见范围在服务端强制过滤，不得只靠前端隐藏；越权返回 404（不泄露资源存在性）」。
 *
 * 四级范围（开发上下文 §6.2）：
 *   VIS_L0 私密  本人 / 讲师 / 家长            默认
 *   VIS_L1 本班  同期班学员与家长            需勾选
 *   VIS_L2 跨期  本校区在读与结业学员及家长   需二次授权
 *   VIS_L3 对外  公开链接 / 分享海报          逐件授权 + 水印
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { VisibilityScope } from '@dreamcity/shared';
import { getDb, schema } from '../../db/driver.js';

export type ViewerRole = 'staff' | 'guardian' | 'student';

export interface Viewer {
  role: ViewerRole;
  id: string;
  /** 讲师身份：能看自己上的课 */
  isTeacherOfSession?: (sessionId: string | null) => boolean;
}

export interface VisibilityContext {
  /** 当前学生（作品的主人） */
  studentId: string;
  artifactId?: string | null;
  /** 作品所属的课堂会话 */
  sessionId?: string | null;
  /** 作品的可见范围 */
  scope: VisibilityScope;
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = '没找到这个内容') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** 有效授权（未撤回）查询 */
function activeGrants(studentId: string, scopes: VisibilityScope[]) {
  return getDb()
    .select()
    .from(schema.visibilityGrant)
    .where(
      and(
        eq(schema.visibilityGrant.studentId, studentId),
        inArray(schema.visibilityGrant.scope, scopes),
        isNull(schema.visibilityGrant.revokedAt),
      ),
    );
}

/**
 * 判断 viewer 是否与目标学生「同班」。
 * 同班定义：共享同一期次（enrollment.term_id）或共享至少一次课堂会话。
 */
async function isPeerOf(viewer: Viewer, targetStudentId: string): Promise<boolean> {
  const db = getDb();
  const viewerStudentId = viewer.role === 'student' ? viewer.id : null;

  if (viewerStudentId) {
    // 目标学生参与过的课堂里，viewer 是否也在场
    const targetSessions = await db
      .select({ sessionId: schema.classSessionParticipant.sessionId })
      .from(schema.classSessionParticipant)
      .where(eq(schema.classSessionParticipant.studentId, targetStudentId));
    const sessionIds = targetSessions.map((s) => s.sessionId);
    if (sessionIds.length > 0) {
      const shared = await db
        .select({ id: schema.classSessionParticipant.id })
        .from(schema.classSessionParticipant)
        .where(
          and(
            eq(schema.classSessionParticipant.studentId, viewerStudentId),
            inArray(schema.classSessionParticipant.sessionId, sessionIds),
          ),
        )
        .limit(1);
      if (shared.length > 0) return true;
    }
  }

  // 同家长不同孩子也是同班（兄弟姐妹在同一个班里）
  const viewerGuardianId = viewer.role === 'guardian' ? viewer.id : null;
  if (viewerGuardianId) {
    const siblings = await db
      .select({ id: schema.student.id })
      .from(schema.student)
      .where(eq(schema.student.guardianId, viewerGuardianId));
    if (siblings.some((s) => s.id === targetStudentId)) return true;
  }

  // 同期次
  const targetTerms = await db
    .select({ termId: schema.enrollment.termId })
    .from(schema.enrollment)
    .where(eq(schema.enrollment.studentId, targetStudentId));
  const termIds = targetTerms.map((t) => t.termId).filter((t): t is string => !!t);
  if (termIds.length === 0) return false;

  if (viewerStudentId) {
    const viewerTerms = await db
      .select({ termId: schema.enrollment.termId })
      .from(schema.enrollment)
      .where(eq(schema.enrollment.studentId, viewerStudentId));
    if (viewerTerms.some((t) => t.termId && termIds.includes(t.termId))) return true;
  }
  if (viewerGuardianId) {
    const kids = await db
      .select({ id: schema.student.id })
      .from(schema.student)
      .where(eq(schema.student.guardianId, viewerGuardianId));
    if (kids.length === 0) return false;
    const kidTerms = await db
      .select({ termId: schema.enrollment.termId })
      .from(schema.enrollment)
      .where(inArray(schema.enrollment.studentId, kids.map((k) => k.id)));
    if (kidTerms.some((t) => t.termId && termIds.includes(t.termId))) return true;
  }
  return false;
}

/**
 * 计算 viewer 对某个学生的可见范围集合。
 * 返回的是「上限范围」，实际判定还要看每件作品自己的 scope 与逐件授权。
 */
export async function visibleScopesFor(viewer: Viewer, targetStudentId: string): Promise<Set<VisibilityScope>> {
  const db = getDb();
  const scopes = new Set<VisibilityScope>(['VIS_L0']);

  const target = await db
    .select({ guardianId: schema.student.guardianId })
    .from(schema.student)
    .where(eq(schema.student.id, targetStudentId))
    .limit(1);
  const targetStudent = target[0];
  if (!targetStudent) return scopes;

  // 本人
  if (viewer.role === 'student' && viewer.id === targetStudentId) {
    scopes.add('VIS_L0');
    return scopes;
  }
  // 家长
  if (viewer.role === 'guardian' && viewer.id === targetStudent.guardianId) {
    scopes.add('VIS_L0');
  }

  const grants = await activeGrants(targetStudentId, ['VIS_L1', 'VIS_L2', 'VIS_L3']);
  const hasL1 = grants.some((g) => g.scope === 'VIS_L1');
  const hasL2 = grants.some((g) => g.scope === 'VIS_L2');

  if (hasL1 && (await isPeerOf(viewer, targetStudentId))) {
    scopes.add('VIS_L1');
  }
  if (hasL2) {
    // 本校区在读与结业学员及家长 —— 机构内身份即可
    if (viewer.role === 'student' || viewer.role === 'guardian' || viewer.role === 'staff') {
      scopes.add('VIS_L2');
    }
  }
  return scopes;
}

/**
 * 判定一件作品对某 viewer 是否可见。
 * `withWatermark` 为真时表示这是对外分享通道（VIS_L3），必须加水印。
 */
export async function canViewArtifact(
  viewer: Viewer,
  ctx: VisibilityContext,
): Promise<{ visible: boolean; watermark: boolean }> {
  const db = getDb();

  // 讲师：该课的主讲
  if (viewer.role === 'staff' && ctx.sessionId) {
    const owned = await db
      .select({ id: schema.classSession.id })
      .from(schema.classSession)
      .where(
        and(
          eq(schema.classSession.id, ctx.sessionId),
          eq(schema.classSession.teacherId, viewer.id),
        ),
      )
      .limit(1);
    if (owned.length > 0) return { visible: true, watermark: false };
  }

  const scopes = await visibleScopesFor(viewer, ctx.studentId);
  if (!scopes.has(ctx.scope)) return { visible: false, watermark: false };

  // VIS_L2 / VIS_L3 需要逐件授权（C10）
  if (ctx.scope === 'VIS_L2' || ctx.scope === 'VIS_L3') {
    const grants = await activeGrants(ctx.studentId, [ctx.scope]);
    const itemGranted = grants.some(
      (g) => g.scope === ctx.scope && (g.artifactId === null || g.artifactId === ctx.artifactId),
    );
    if (!itemGranted) return { visible: false, watermark: false };
  }

  return { visible: true, watermark: ctx.scope === 'VIS_L3' };
}

/** 不可见即 404（不泄露资源存在性） */
export async function assertCanViewArtifact(
  viewer: Viewer,
  ctx: VisibilityContext,
): Promise<{ watermark: boolean }> {
  const result = await canViewArtifact(viewer, ctx);
  if (!result.visible) throw new NotFoundError();
  return { watermark: result.watermark };
}

/**
 * 取一批作品里 viewer 能看到的那部分（用于列表）。
 * 越权的直接不出现在结果里，而不是返回 403。
 */
export async function filterVisibleArtifacts<T extends VisibilityContext>(
  viewer: Viewer,
  items: T[],
): Promise<{ item: T; watermark: boolean }[]> {
  const out: { item: T; watermark: boolean }[] = [];
  for (const item of items) {
    const r = await canViewArtifact(viewer, item);
    if (r.visible) out.push({ item, watermark: r.watermark });
  }
  return out;
}

/** 家长可见范围的开关状态 */
export async function getGrantState(guardianId: string, studentId: string) {
  const db = getDb();
  const grants = await db
    .select()
    .from(schema.visibilityGrant)
    .where(eq(schema.visibilityGrant.guardianId, guardianId));
  return {
    VIS_L1: grants.some((g) => g.studentId === studentId && g.scope === 'VIS_L1' && !g.revokedAt),
    VIS_L2: grants.some((g) => g.studentId === studentId && g.scope === 'VIS_L2' && !g.revokedAt),
    VIS_L3: grants.some((g) => g.studentId === studentId && g.scope === 'VIS_L3' && !g.revokedAt),
    items: grants.filter((g) => g.studentId === studentId),
  };
}

/** 撤回授权：逐件可撤回（C10） */
export async function revokeGrants(
  guardianId: string,
  studentId: string,
  scope: VisibilityScope,
  artifactId?: string | null,
): Promise<number> {
  const db = getDb();
  const conditions = [
    eq(schema.visibilityGrant.guardianId, guardianId),
    eq(schema.visibilityGrant.studentId, studentId),
    eq(schema.visibilityGrant.scope, scope),
    isNull(schema.visibilityGrant.revokedAt),
  ];
  if (artifactId) conditions.push(eq(schema.visibilityGrant.artifactId, artifactId));
  const rows = await db
    .update(schema.visibilityGrant)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: schema.visibilityGrant.id });
  return rows.length;
}

/** 是否为该学生所属家长 */
export async function isGuardianOf(guardianId: string, studentId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.student.id })
    .from(schema.student)
    .where(and(eq(schema.student.id, studentId), eq(schema.student.guardianId, guardianId)))
    .limit(1);
  return rows.length > 0;
}

/** 学员在读的期次（用于限定「本校区」范围） */
export async function studentTermIds(studentId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ termId: schema.enrollment.termId })
    .from(schema.enrollment)
    .where(eq(schema.enrollment.studentId, studentId));
  return rows.map((r) => r.termId).filter((t): t is string => !!t);
}
