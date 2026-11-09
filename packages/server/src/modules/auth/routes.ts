/**
 * 认证路由 —— 讲师账密 / 家长短信 / 学员课堂码
 *
 * 学员侧刻意不设密码：课堂码进入 + 头像选择（C9）。
 */

import type { FastifyInstance } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../../db/driver.js';
import {
  generateClassCode,
  generateSmsCode,
  issueStudentToken,
  issueToken,
  verifyPassword,
} from '../../lib/auth.js';
import { cacheKeys, getCache } from '../../lib/cache.js';
import { getSmsSender } from '../../lib/sms.js';
import { rateLimit } from '../../lib/ratelimit.js';
import { ADMIN_USING_DEFAULT_PASSWORD, CLASS_CODE_TTL_SECONDS, env } from '../../env.js';

const staffLoginSchema = z.object({
  /** 账号：可以是邮箱，也可以是账号名（占位账号 admin / 讲师姓名） */
  username: z.string().min(1).max(120),
  password: z.string().min(1),
});

const phoneSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不对'),
});

const studentEnterSchema = z.object({
  classCode: z.string().regex(/^\d{6}$/),
});

/**
 * 请求体没解析出来（比如客户端忘了带 Content-Type）时，
 * 应该说「请求格式不对」，而不是「手机号格式不对」—— 那是误导。
 */
function bodyMissing(req: { body?: unknown }): boolean {
  return !req.body || typeof req.body !== 'object';
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  /* ── 讲师 / 运营 / 管理员 ─────────────────────────────── */

  /**
   * 后台登录前的自述接口。
   *
   * 只回答「现在是不是还在用开发默认口令」——
   * 用来决定登录页要不要显示账号提示。默认口令不该出现在任何页面上，
   * 但开发阶段不显示又登不进去，两头都得顾到。
   */
  app.get('/api/auth/staff/config', async () => ({
    /** true 时前端才显示「账号 admin / 密码 123456」的提示 */
    defaultCredentialsInUse: ADMIN_USING_DEFAULT_PASSWORD,
  }));

  app.post('/api/auth/staff/login', async (req, reply) => {
    // 讲师账号要防爆破
    const limit = await rateLimit('staff-login', req.ip, 10, 300);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfter));
      return reply.code(429).send({ error: 'TOO_FREQUENT', message: '试太多次了，等一会儿再来' });
    }
    const body = staffLoginSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '账号或密码不对' });
    }
    const username = body.data.username.trim();
    // 账号可以是邮箱，也可以是账号名 / 讲师姓名 —— 都试一遍
    const rows = await db
      .select()
      .from(schema.staffUser)
      .where(
        or(
          eq(schema.staffUser.email, username.toLowerCase()),
          eq(schema.staffUser.name, username),
        ),
      )
      .limit(1);
    const user = rows[0];
    if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
      // 不区分「账号不存在」与「密码错误」，避免账号枚举
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: '账号或密码不对' });
    }
    const token = issueToken({ sub: user.id, role: 'staff' });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  });

  /* ── 家长：手机号 + 短信验证码 ───────────────────────── */

  app.post('/api/auth/guardian/send-code', async (req, reply) => {
    if (bodyMissing(req)) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '请求格式不对' });
    }
    const body = phoneSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '手机号格式不对' });
    }
    const cache = await getCache();
    const phone = body.data.phone;

    // 限流：同一手机号 60 秒内只能发一次
    const sentKey = cacheKeys.smsAttempts(phone);
    const lastSent = await cache.get(sentKey);
    if (lastSent) {
      return reply.code(429).send({ error: 'TOO_FREQUENT', message: '刚发过啦，等一分钟再试' });
    }
    // 手机号与 IP 双重限流，防止有人拿别人的号轰炸。
    // IP 的额度要够一整个教室用 —— 一个班几十个手机号共用同一个公网 IP，
    // 按 10 次/小时会把全班一起挡在门外。
    const byPhone = await rateLimit('sms-send-phone', phone, 5, 3600);
    const byIp = await rateLimit('sms-send-ip', req.ip, 60, 3600);
    if (!byPhone.allowed || !byIp.allowed) {
      reply.header('Retry-After', String(byPhone.retryAfter));
      return reply.code(429).send({ error: 'TOO_FREQUENT', message: '今天发得有点多，明天再试' });
    }

    const code =
      env.sms.driver === 'log'
        ? // 开发模式固定验证码，便于自动化测试；生产走真实随机码
          (process.env.SMS_DEV_CODE ?? '00000')
        : generateSmsCode();
    await cache.set(cacheKeys.smsCode(phone), code, 5 * 60);
    await cache.set(sentKey, '1', env.sms.rateLimitSeconds);
    await getSmsSender().sendVerificationCode(phone, code);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/guardian/login', async (req, reply) => {
    if (bodyMissing(req)) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '请求格式不对' });
    }
    const body = z.object({ phone: phoneSchema.shape.phone, code: z.string().min(4) }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '手机号或验证码不对' });
    }
    // 验证码只有 5 位，必须限制失败次数，否则可以穷举。
    // 开发模式（SMS_DRIVER=log）验证码是固定的，没有可爆破的秘密，不限。
    if (env.sms.driver !== 'log') {
      const attempts = await rateLimit('sms-verify', body.data.phone, 5, 300);
      if (!attempts.allowed) {
        reply.header('Retry-After', String(attempts.retryAfter));
        return reply.code(429).send({
          error: 'TOO_FREQUENT',
          message: '验证码试错太多次了，重新发一个吧',
        });
      }
    }
    const cache = await getCache();
    const expected = await cache.get(cacheKeys.smsCode(body.data.phone));
    if (!expected || expected !== body.data.code) {
      return reply.code(401).send({ error: 'INVALID_CODE', message: '验证码不对，再看看' });
    }
    await cache.del(cacheKeys.smsCode(body.data.phone));

    let rows = await db
      .select()
      .from(schema.guardian)
      .where(eq(schema.guardian.phone, body.data.phone))
      .limit(1);
    let guardian: { id: string; phone: string; name: string } | undefined = rows[0];
    if (!guardian) {
      // 家长端是「先看到孩子」再补信息的：手机号不存在时自动建一个空档案
      const id = `grd_${crypto.randomUUID()}`;
      await db.insert(schema.guardian).values({
        id,
        phone: body.data.phone,
        name: '家长',
        smsVerifiedAt: new Date(),
      });
      guardian = { id, phone: body.data.phone, name: '家长' };
    }

    const token = issueToken({ sub: guardian.id, role: 'guardian' });
    return reply.send({
      token,
      guardian: { id: guardian.id, name: guardian.name, phone: guardian.phone },
    });
  });

  /* ── 学员：课堂码进入 ────────────────────────────────── */

  /**
   * 第一步：输入课堂码。
   * 返回本班可选的学员（头像 + 昵称），让孩子点一下就行，不给密码框。
   */
  app.post('/api/auth/student/enter', async (req, reply) => {
    // 课堂码只有 6 位（100 万组合），必须限流否则可爆破
    const limit = await rateLimit('classcode', req.ip, 10, 60);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfter));
      return reply.code(429).send({ error: 'TOO_FREQUENT', message: '试太多次了，问老师要一次吧' });
    }
    const body = studentEnterSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '课堂码是 6 位数字' });
    }
    const cache = await getCache();
    const sessionId = await cache.get(cacheKeys.classCode(body.data.classCode));
    if (!sessionId) {
      // 课堂码无效 / 已过期 / 已结课 —— 统一话术，不泄露具体原因
      return reply.code(404).send({ error: 'INVALID_CLASS_CODE', message: '这个课堂码好像不对' });
    }

    const sessions = await db
      .select()
      .from(schema.classSession)
      .where(eq(schema.classSession.id, sessionId))
      .limit(1);
    const session = sessions[0];
    if (!session || session.state !== 'LIVE') {
      return reply.code(404).send({ error: 'INVALID_CLASS_CODE', message: '这个课堂码已经用完了' });
    }

    const participants = await db
      .select({
        studentId: schema.student.id,
        displayName: schema.student.displayName,
        avatarKey: schema.student.avatarKey,
        avatarStage: schema.student.avatarStage,
      })
      .from(schema.classSessionParticipant)
      .innerJoin(schema.student, eq(schema.student.id, schema.classSessionParticipant.studentId))
      .where(eq(schema.classSessionParticipant.sessionId, sessionId));

    return reply.send({
      sessionId,
      lessonTitle: null,
      /** 名单还没点完时，前端要给出「老师还在点名」的引导，而不是空白页 */
      rosterPending: participants.length === 0,
      students: participants,
    });
  });

  /**
   * 第二步：点选自己的头像，换一个短时效的课堂令牌。
   * 这个令牌不是账号：不含密码、不产生长期身份（C9）。
   */
  app.post('/api/auth/student/pick', async (req, reply) => {
    const limit = await rateLimit('classcode-pick', req.ip, 20, 60);
    if (!limit.allowed) {
      reply.header('Retry-After', String(limit.retryAfter));
      return reply.code(429).send({ error: 'TOO_FREQUENT', message: '试太多次了，问老师要一次吧' });
    }
    const body = z
      .object({ classCode: z.string().regex(/^\d{6}$/), studentId: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'BAD_REQUEST', message: '课堂码是 6 位数字' });
    }
    const cache = await getCache();
    const sessionId = await cache.get(cacheKeys.classCode(body.data.classCode));
    if (!sessionId) {
      return reply.code(404).send({ error: 'INVALID_CLASS_CODE', message: '这个课堂码好像不对' });
    }

    const rows = await db
      .select()
      .from(schema.classSessionParticipant)
      .where(
        and(
          eq(schema.classSessionParticipant.sessionId, sessionId),
          eq(schema.classSessionParticipant.studentId, body.data.studentId),
        ),
      )
      .limit(1);
    if (rows.length === 0) {
      // 课堂码是对的，只是这个孩子还没被排进这节课 —— 给出可行动的下一步
      const students = await db
        .select({ id: schema.student.id })
        .from(schema.student)
        .where(eq(schema.student.id, body.data.studentId))
        .limit(1);
      if (students.length > 0) {
        return reply.code(404).send({
          error: 'NOT_ON_LIST',
          message: '今天这节课你还没被排进来，让老师把你加进来就好',
        });
      }
      return reply.code(404).send({ error: 'INVALID_CLASS_CODE', message: '这个课堂码好像不对' });
    }

    const token = issueStudentToken(body.data.studentId, sessionId);
    await cache.set(
      cacheKeys.studentSession(body.data.studentId, sessionId),
      '1',
      CLASS_CODE_TTL_SECONDS,
    );

    const studentRows = await db
      .select()
      .from(schema.student)
      .where(eq(schema.student.id, body.data.studentId))
      .limit(1);
    const student = studentRows[0];

    return reply.send({
      token,
      sessionId,
      student: student
        ? {
            id: student.id,
            displayName: student.displayName,
            avatarKey: student.avatarKey,
            avatarStage: student.avatarStage,
            grade: student.grade,
          }
        : null,
    });
  });
}
