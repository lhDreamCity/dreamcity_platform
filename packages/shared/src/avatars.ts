/**
 * 学员头像目录
 *
 * 12 个几何头像 × 3 个装备阶段（随 GRADE_L1 → L2 → L3 升级）。
 * 用 SVG 现画，不依赖位图资源 —— 12 × 3 = 36 种组合够用且零请求。
 *
 * 头像只标识身份，不采集真实姓名与正脸照（设计方案 §2.3.2 昵称制）。
 */

export const AVATAR_KEYS = [
  'a01', 'a02', 'a03', 'a04', 'a05', 'a06',
  'a07', 'a08', 'a09', 'a10', 'a11', 'a12',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

/** 12 个头像的主色（与 PPT 设计系统的级别色同族，但每个头像一个色相） */
export const AVATAR_COLORS: Record<AvatarKey, string> = {
  a01: '#2E7CF6',
  a02: '#22D3EE',
  a03: '#7C6BFF',
  a04: '#F2A33C',
  a05: '#FF7A6B',
  a06: '#4ADE9B',
  a07: '#5B8DEF',
  a08: '#C084FC',
  a09: '#FBBF24',
  a10: '#F472B6',
  a11: '#34D399',
  a12: '#60A5FA',
};

/** 装备阶段：1 基础 → 2 加天线 → 3 加星星 */
export const AVATAR_STAGES = [1, 2, 3] as const;
export type AvatarStage = (typeof AVATAR_STAGES)[number];

export function isAvatarKey(v: unknown): v is AvatarKey {
  return typeof v === 'string' && (AVATAR_KEYS as readonly string[]).includes(v);
}

export function avatarColor(key: string): string {
  return AVATAR_COLORS[key as AvatarKey] ?? '#7E9AAE';
}

/** 根据年级段给一个默认头像，省得每次都要挑 */
export function defaultAvatarForGrade(grade: number): AvatarKey {
  const idx = Math.max(0, Math.min(11, (grade - 3) * 2)) % AVATAR_KEYS.length;
  return AVATAR_KEYS[idx]!;
}
