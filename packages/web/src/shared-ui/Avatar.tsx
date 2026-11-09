import { avatarColor } from '@dreamcity/shared';

/**
 * 学员头像
 *
 * 12 个几何头像 × 3 个装备阶段（随级别升级）。
 * 用 SVG 现画：零图片请求、任意尺寸不糊、装备升级一眼看得见。
 *
 * 头像只标识身份 —— 不采集真实姓名与正脸照（昵称制）。
 */
export function Avatar({
  avatarKey,
  stage = 1,
  size = 44,
  title,
}: {
  avatarKey: string;
  stage?: number;
  size?: number;
  title?: string;
}) {
  const c = avatarColor(avatarKey);
  const s = size;
  const r = s * 0.42;

  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title ?? '头像'}
      style={{ flex: 'none', display: 'block' }}
    >
      {/* 底座 */}
      <circle cx="32" cy="32" r={r} fill="#fff" stroke={c} strokeWidth="3" />
      {/* 面屏 */}
      <circle cx="32" cy="32" r={r * 0.72} fill={c} opacity="0.16" />
      {/* 眼睛 */}
      <circle cx="24" cy="29" r="3.1" fill="#123046" />
      <circle cx="40" cy="29" r="3.1" fill="#123046" />
      {/* 笑弧（正向引导，不用红叉） */}
      <path
        d="M25 38 Q32 43 39 38"
        stroke="#123046"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      {/* 阶段 2：天线 */}
      {stage >= 2 ? (
        <>
          <line x1="32" y1="14" x2="32" y2="8" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="32" cy="6" r="4" fill="#FFD84D" stroke={c} strokeWidth="1.6" />
        </>
      ) : null}
      {/* 阶段 3：胸前的星 */}
      {stage >= 3 ? (
        <path
          d="M32 46 l2.2 4.6 5 .7 -3.6 3.5 .9 5 -4.5-2.4 -4.5 2.4 .9-5 -3.6-3.5 5-.7z"
          fill="#FFD84D"
          stroke={c}
          strokeWidth="1.2"
          transform="translate(0 4) scale(0.72) translate(12.4 3)"
        />
      ) : null}
    </svg>
  );
}
