/**
 * 认证与令牌
 *
 * 三种身份：
 *   staff    讲师 / 运营 / 管理员 —— 邮箱 + 密码
 *   guardian 家长 —— 手机号 + 短信验证码
 *   student  学员 —— 课堂码换来的短时效会话凭证（不产生长期身份，C9）
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env, STUDENT_TOKEN_TTL_MINUTES } from '../env.js';

/* ── 密码 ───────────────────────────────────────────────────── */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/* ── 令牌（HS256 JWT，自实现以避免额外依赖）─────────────────── */

export type TokenRole = 'staff' | 'guardian' | 'student';

export interface TokenPayload {
  /** 用户 id */
  sub: string;
  role: TokenRole;
  /** 课堂会话 id（student / staff 上课时用） */
  sid?: string;
  /** 签发与过期时间（秒） */
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  const secret = env.token.secret || 'dreamcity-dev-token-secret';
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function issueToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'>,
  ttlMinutes = env.token.ttlMinutes,
): string {
  const iat = Math.floor(Date.now() / 1000);
  const body: TokenPayload = { ...payload, iat, exp: iat + ttlMinutes * 60 };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify(body));
  const sig = sign(`${header}.${claims}`);
  return `${header}.${claims}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, claims, sig] = parts as [string, string, string];
  const expected = sign(`${header}.${claims}`);
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 学生课堂令牌：短时效，绑定课堂会话 */
export function issueStudentToken(studentId: string, sessionId: string): string {
  return issueToken({ sub: studentId, role: 'student', sid: sessionId }, STUDENT_TOKEN_TTL_MINUTES);
}

/* ── 6 位课堂码 ─────────────────────────────────────────────── */

/**
 * 课堂码：6 位数字，当堂有效、下课失效的会话凭证（C9）。
 * 不是学生账号，不产生长期身份。
 */
export function generateClassCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += String(Math.floor(random() * 10));
  }
  return code;
}

/* ── 短信验证码 ─────────────────────────────────────────────── */

export function generateSmsCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 100000).padStart(5, '0');
}

export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
