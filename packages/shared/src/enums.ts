/**
 * 梦之城综合教学平台 · 枚举（唯一真相源）
 *
 * ⚠️ 命名陷阱（开发上下文 §2.2，本项目最可能出错的一处）
 * 历史文档里同时存在两套 `L` 编号，含义完全不同：
 *   GRADE_L1 / GRADE_L2 / GRADE_L3 = 课程级别（按年级段）
 *   VIS_L0 / VIS_L1 / VIS_L2 / VIS_L3 = 作品可见范围
 * 代码里禁止出现裸的 `L1` / `L2` / `L3`。
 * 裸 `L1` 会被 `tools/check-constraints` 的命名纪律检查拦下。
 */

/* ────────────────────────────────────────────────────────────
 * 课程级别 GRADE_L*（按年级段）
 * ──────────────────────────────────────────────────────────── */

export const GRADE_LEVELS = ['GRADE_L1', 'GRADE_L2', 'GRADE_L3'] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export interface GradeMeta {
  id: GradeLevel;
  /** 级别代号，用于显示（不带前缀） */
  code: string;
  name: string;
  gradeRange: string;
  theme: string;
  seq: number;
  /** 该级别的成长档案配色（与 PPT 设计稿一致） */
  visual: 'storybook' | 'lab' | 'stage';
}

export const GRADE_META: Record<GradeLevel, GradeMeta> = {
  GRADE_L1: {
    id: 'GRADE_L1',
    code: 'L1',
    name: '启蒙级',
    gradeRange: '3–4 年级',
    theme: 'AI 好朋友 · 创意初体验',
    seq: 1,
    visual: 'storybook',
  },
  GRADE_L2: {
    id: 'GRADE_L2',
    code: 'L2',
    name: '进阶级',
    gradeRange: '5–6 年级',
    theme: '数据的力量 · AI 创客',
    seq: 2,
    visual: 'lab',
  },
  GRADE_L3: {
    id: 'GRADE_L3',
    code: 'L3',
    name: '实战级',
    gradeRange: '7–9 年级',
    theme: 'AI 实战家 · 少年 CEO',
    seq: 3,
    visual: 'stage',
  },
};

/* ────────────────────────────────────────────────────────────
 * 作品可见范围 VIS_L*（与课程级别无关，勿混）
 * ──────────────────────────────────────────────────────────── */

export const VISIBILITY_SCOPES = ['VIS_L0', 'VIS_L1', 'VIS_L2', 'VIS_L3'] as const;
export type VisibilityScope = (typeof VISIBILITY_SCOPES)[number];

export interface VisibilityMeta {
  id: VisibilityScope;
  name: string;
  /** 谁能看 */
  audience: string;
  /** 默认开启 */
  isDefault: boolean;
  /** 是否需要逐件单独授权 */
  perItemGrant: boolean;
  /** 对外分享时是否强制加水印 */
  watermark: boolean;
  description: string;
}

export const VISIBILITY_META: Record<VisibilityScope, VisibilityMeta> = {
  VIS_L0: {
    id: 'VIS_L0',
    name: '私密',
    audience: '本人 / 讲师 / 家长',
    isDefault: true,
    perItemGrant: false,
    watermark: false,
    description: '草稿、失败尝试、测评原始分。默认范围。',
  },
  VIS_L1: {
    id: 'VIS_L1',
    name: '本班',
    audience: '同期班学员与家长',
    isDefault: false,
    perItemGrant: false,
    watermark: false,
    description: '同伴互评（A4）、当期作品墙。报名时一次授权。',
  },
  VIS_L2: {
    id: 'VIS_L2',
    name: '跨期',
    audience: '本校区在读与结业学员及家长',
    isDefault: false,
    perItemGrant: true,
    watermark: false,
    description: '异步互评，往期作品当「虚拟同伴」。家长单独同意。',
  },
  VIS_L3: {
    id: 'VIS_L3',
    name: '对外',
    audience: '公开链接 / 分享海报',
    isDefault: false,
    perItemGrant: true,
    watermark: true,
    description: '招生素材、家长转发、转介绍。逐件授权、带水印、可撤回。',
  },
};

/* ────────────────────────────────────────────────────────────
 * 交互原子 A1–A8（谁握控制权 × 信息往哪流）
 * ──────────────────────────────────────────────────────────── */

export const ATOMS = [
  'ATOM_A1',
  'ATOM_A2',
  'ATOM_A3',
  'ATOM_A4',
  'ATOM_A5',
  'ATOM_A6',
  'ATOM_A7',
  'ATOM_A8',
] as const;
export type Atom = (typeof ATOMS)[number];

export interface AtomMeta {
  id: Atom;
  code: string;
  name: string;
  description: string;
}

export const ATOM_META: Record<Atom, AtomMeta> = {
  ATOM_A1: { id: 'ATOM_A1', code: 'A1', name: '讲师一对多讲演', description: '讲授锚定，课件按页推进。' },
  ATOM_A2: { id: 'ATOM_A2', code: 'A2', name: '学生自行使用 PC 钻研', description: '人机钻研，孩子自己动手。' },
  ATOM_A3: { id: 'ATOM_A3', code: 'A3', name: '讲师与全场互动 / 游戏', description: '全场共振，结果实时上屏。' },
  ATOM_A4: { id: 'ATOM_A4', code: 'A4', name: '学生间互动 / 游戏', description: '同伴协作，两两互访与互评。' },
  ATOM_A5: { id: 'ATOM_A5', code: 'A5', name: '讲师与单个学生互动', description: '个别点拨，溢价来源之一。' },
  ATOM_A6: { id: 'ATOM_A6', code: 'A6', name: '学生对外输出', description: '家长可见成果、续费依据、传播素材的唯一来源。' },
  ATOM_A7: { id: 'ATOM_A7', code: 'A7', name: 'AI / 平台作为第三角色', description: 'AI 认错的瞬间，AI-native 机构的分水岭。' },
  ATOM_A8: { id: 'ATOM_A8', code: 'A8', name: '外部真实对象', description: '家长当顾客、嘉宾当评委，把表演变成真实检验。' },
};

/* ────────────────────────────────────────────────────────────
 * 模式卡 M1–M6（按课型把原子装配进 90 分钟）
 * ──────────────────────────────────────────────────────────── */

export const MODE_CARDS = ['MODE_M1', 'MODE_M2', 'MODE_M3', 'MODE_M4', 'MODE_M5', 'MODE_M6'] as const;
export type ModeCard = (typeof MODE_CARDS)[number];

export interface ModeMeta {
  id: ModeCard;
  code: string;
  name: string;
  description: string;
  /** 失效信号：出现这个信号就要换卡 */
  failureSignal: string;
  /** 必须真人承担（红线，AI 不得替代） */
  teacherOnly: boolean;
}

export const MODE_META: Record<ModeCard, ModeMeta> = {
  MODE_M1: {
    id: 'MODE_M1',
    code: 'M1',
    name: '讲授锚定',
    description: '课件按页推进，讲清一个概念。讲授单次不超过 25 分钟。',
    failureSignal: '连续 10 分钟无人动手，孩子眼神游离 —— 立刻切 M2。',
    teacherOnly: false,
  },
  MODE_M2: {
    id: 'MODE_M2',
    code: 'M2',
    name: '人机钻研',
    description: '孩子自己动手：课眼游戏、任务单、工具实操。',
    failureSignal: '孩子在等答案而不是在试 —— 收窄任务，给一个明确的下一步。',
    teacherOnly: false,
  },
  MODE_M3: {
    id: 'MODE_M3',
    code: 'M3',
    name: '全场共振',
    description: '投票、抢答、情境卡翻牌，结果实时上屏。',
    failureSignal: '参与人数掉到半数以下 —— 改成分组抢答，别让举手的人太少。',
    teacherOnly: false,
  },
  MODE_M4: {
    id: 'MODE_M4',
    code: 'M4',
    name: '同伴协作',
    description: '两两互访、小组分工、组间互评。',
    failureSignal: '出现「你帮我做」—— 拆成角色单，明确谁做什么。',
    teacherOnly: false,
  },
  MODE_M5: {
    id: 'MODE_M5',
    code: 'M5',
    name: '个别点拨',
    description: '讲师单独点拨一个孩子。这是溢价的核心，必须真人。',
    failureSignal: '轮巡名单里有孩子一整节没被单独问过 —— 立刻补一次。',
    teacherOnly: true,
  },
  MODE_M6: {
    id: 'MODE_M6',
    code: 'M6',
    name: '对外输出',
    description: '当堂展示与对外表达。家长可见成果的来源，必须真人。',
    failureSignal: '孩子只是「念一遍」—— 换成对着家长 / 同学讲一件具体的事。',
    teacherOnly: true,
  },
};

/* ────────────────────────────────────────────────────────────
 * 90 分钟五环节
 * ──────────────────────────────────────────────────────────── */

export const PHASES = ['导入', '讲解', '实操', '展示', '收尾'] as const;
export type Phase = (typeof PHASES)[number];

/** 平台默认的五环节时长模板（分钟）—— 合计 90 */
export const DEFAULT_PHASE_MINUTES: Record<Phase, number> = {
  导入: 10,
  讲解: 20,
  实操: 35,
  展示: 15,
  收尾: 10,
};

/** 讲授（导入 + 讲解）上限，硬约束 C6 / 设计方案 §4.2 */
export const MAX_LECTURE_MINUTES = 25;

/* ────────────────────────────────────────────────────────────
 * 班型（开发上下文 §4.4：下限 ≥2 人小班，不设计 1 对 1）
 * ──────────────────────────────────────────────────────────── */

export const MIN_PARTICIPANT_COUNT = 2;

/* ────────────────────────────────────────────────────────────
 * 课型配方（按课型给 M 卡序列，功能地图 §04）
 * ──────────────────────────────────────────────────────────── */

export const LESSON_RECIPES = [
  '概念课',
  '工具课',
  '项目课',
  '实战课',
  '结业课',
] as const;
export type LessonRecipe = (typeof LESSON_RECIPES)[number];

export interface RecipeTemplate {
  recipe: LessonRecipe;
  /** 模式卡序列，驱动编排器的默认排布 */
  sequence: ModeCard[];
  description: string;
}

export const RECIPE_TEMPLATES: Record<LessonRecipe, RecipeTemplate> = {
  概念课: {
    recipe: '概念课',
    sequence: ['MODE_M3', 'MODE_M1', 'MODE_M2', 'MODE_M5', 'MODE_M6', 'MODE_M1'],
    description: '先共振抓住注意力，再讲清概念，动手验证，个别点拨，对外输出收口。',
  },
  工具课: {
    recipe: '工具课',
    sequence: ['MODE_M1', 'MODE_M2', 'MODE_M5', 'MODE_M4', 'MODE_M6', 'MODE_M1'],
    description: '讲用法 → 上手练 → 点拨卡点 → 同伴互查 → 对外输出。',
  },
  项目课: {
    recipe: '项目课',
    sequence: ['MODE_M1', 'MODE_M4', 'MODE_M2', 'MODE_M5', 'MODE_M6', 'MODE_M1'],
    description: '分工协作贯穿全程，讲师在 M5 巡场补位。',
  },
  实战课: {
    recipe: '实战课',
    sequence: ['MODE_M3', 'MODE_M2', 'MODE_M4', 'MODE_M5', 'MODE_M6', 'MODE_M1'],
    description:
      '真实检验优先：热身共振 → 上手跑一轮 → 同伴互评 → 讲师点拨 → 对外输出。涉及外部真实对象时在编排器里给该环节标 ATOM_A8。',
  },
  结业课: {
    recipe: '结业课',
    sequence: ['MODE_M3', 'MODE_M6', 'MODE_M5', 'MODE_M4', 'MODE_M6', 'MODE_M1'],
    description: '对外输出为主，结构化互评，复盘收口。',
  },
};

/* ────────────────────────────────────────────────────────────
 * 工具函数
 * ──────────────────────────────────────────────────────────── */

export function isGradeLevel(v: unknown): v is GradeLevel {
  return typeof v === 'string' && (GRADE_LEVELS as readonly string[]).includes(v);
}

export function isVisibilityScope(v: unknown): v is VisibilityScope {
  return typeof v === 'string' && (VISIBILITY_SCOPES as readonly string[]).includes(v);
}

export function isModeCard(v: unknown): v is ModeCard {
  return typeof v === 'string' && (MODE_CARDS as readonly string[]).includes(v);
}

export function isAtom(v: unknown): v is Atom {
  return typeof v === 'string' && (ATOMS as readonly string[]).includes(v);
}

/**
 * 可见范围排序：数字越大越宽。
 * 「可见」判定 = viewer's scope level >= artifact's scope level，
 * 但逐件授权（VIS_L2 / VIS_L3）必须单独有未撤回的 grant。
 */
export function scopeRank(scope: VisibilityScope): number {
  return VISIBILITY_SCOPES.indexOf(scope);
}

/** 课次 id 形如 `L1-01`、`L3-16`（这是课次编号，不是级别常量） */
export const LESSON_ID_PATTERN = /^L[123]-(\d{2})$/;

export function parseLessonId(lessonId: string): { grade: GradeLevel; seq: number } | null {
  const m = LESSON_ID_PATTERN.exec(lessonId);
  if (!m) return null;
  const seq = Number(m[1]);
  const grade = `GRADE_L${m[0][1]}` as GradeLevel;
  return isGradeLevel(grade) ? { grade, seq } : null;
}
