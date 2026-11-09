/**
 * 数据模型 —— 承自《梦之城综合教学平台设计方案 V1.1》§4
 *
 * 三层分离（§4.2）：
 *   模板层  level → unit → lesson → lesson_plan_version
 *   实例层  lesson + plan_version → class_session → session_activity → session_record
 *   价值层  guardian → student → enrollment → artifact / assessment / observation
 *
 * 两条结构性红线：
 *   C5  lesson 与 class_session 拆表，class_session 指向当时的教案版本快照
 *   C8  表里不存在任何量化人气字段（like_count / view_count / rank / popularity …）
 *       「谁看过」用 artifact_view 的行记录表达，不存计数。
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ══════════════════════════════════════════════════════════
 * 模板层 · 课程内容
 * ══════════════════════════════════════════════════════════ */

export const level = pgTable('level', {
  /** GRADE_L1 / GRADE_L2 / GRADE_L3 —— 禁止裸 L1（命名纪律） */
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  gradeRange: text('grade_range').notNull(),
  theme: text('theme').notNull(),
  seq: integer('seq').notNull(),
  goals: jsonb('goals').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const unit = pgTable(
  'unit',
  {
    id: text('id').primaryKey(),
    levelId: text('level_id')
      .notNull()
      .references(() => level.id),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('unit_level_seq_uq').on(t.levelId, t.seq)],
);

export const lesson = pgTable(
  'lesson',
  {
    /** 形如 L1-01 —— 这是课次编号，不是级别常量 */
    id: text('id').primaryKey(),
    unitId: text('unit_id')
      .notNull()
      .references(() => unit.id),
    levelId: text('level_id')
      .notNull()
      .references(() => level.id),
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    /** 课堂产出（成长档案目录） */
    output: text('output').notNull().default(''),
    defaultRecipe: text('default_recipe'),
    /** 当前生效的教案版本 */
    currentVersionId: text('current_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lesson_level_seq_uq').on(t.levelId, t.seq)],
);

/** 教案版本快照 —— 只增不改（C5） */
export const lessonPlanVersion = pgTable(
  'lesson_plan_version',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lesson.id),
    version: integer('version').notNull(),
    /** 细案十字段 + 五环节原文 */
    contentJson: jsonb('content_json').$type<Record<string, unknown>>().notNull(),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lesson_plan_version_uq').on(t.lessonId, t.version)],
);

/** 活动插件注册表 */
export const activityPlugin = pgTable('activity_plugin', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  entry: text('entry').notNull(),
  manifestJson: jsonb('manifest_json').$type<Record<string, unknown>>().notNull(),
  resultSchema: jsonb('result_schema').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ══════════════════════════════════════════════════════════
 * 实例层 · 课堂执行
 * ══════════════════════════════════════════════════════════ */

export const staffUser = pgTable(
  'staff_user',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** TEACHER / OPS / ADMIN */
    role: text('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('staff_user_email_uq').on(t.email)],
);

/**
 * 一次真实上课 —— 数据模型的主键（设计方案 §4.2）
 * planVersionId 指向「当时的」教案快照：改细案不影响往期记录。
 */
export const classSession = pgTable(
  'class_session',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lesson.id),
    planVersionId: text('plan_version_id')
      .notNull()
      .references(() => lessonPlanVersion.id),
    termId: text('term_id'),
    /** 6 位课堂码（当堂有效、下课失效） */
    classCode: text('class_code'),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => staffUser.id),
    roomName: text('room_name'),
    /** SMALL_GROUP —— 班型基线 ≥2 人小班（开发上下文 §4.4） */
    classType: text('class_type').notNull().default('SMALL_GROUP'),
    participantCount: integer('participant_count').notNull(),
    /** DRAFT / LIVE / CLOSED */
    state: text('state').notNull().default('DRAFT'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('class_session_lesson_idx').on(t.lessonId),
    index('class_session_state_idx').on(t.state),
    // 班型下限 ≥2：不设计 1 对 1，也不为该边界状态做适配
    check('class_session_participant_count_check', sql`${t.participantCount} >= 2`),
  ],
);

/**
 * 课堂编排的最小颗粒。
 * 命名说明：设计方案里的表名叫 `activity`，与 `activity_plugin` 语义冲突，
 * 这里改名为 `session_activity`（映射见 docs/数据模型.md）。
 */
export const sessionActivity = pgTable(
  'session_activity',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => classSession.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    /** 导入 / 讲解 / 实操 / 展示 / 收尾 */
    phase: text('phase').notNull(),
    /** MODE_M1 … MODE_M6 */
    modeCard: text('mode_card'),
    /** ATOM_A1 … ATOM_A8 */
    atom: text('atom'),
    title: text('title').notNull(),
    durationMin: integer('duration_min').notNull(),
    pluginId: text('plugin_id').references(() => activityPlugin.id),
    /** 课件页 / 任务单编号等外部资源引用 */
    resourceId: text('resource_id'),
    /** LESSON_PDF / PLUGIN / VOTE / TASK / SUBMIT / BREAK */
    activityKind: text('activity_kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_activity_session_idx').on(t.sessionId, t.seq)],
);

export const sessionRecord = pgTable(
  'session_record',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => classSession.id, { onDelete: 'cascade' }),
    sessionActivityId: text('session_activity_id').references(() => sessionActivity.id),
    /** PHASE_START / PHASE_END / ACTIVITY_LAUNCH / ACTIVITY_RESULT / CAPTURE */
    recordType: text('record_type').notNull(),
    studentId: text('student_id'),
    /** 环节实耗（自动算出，不需讲师录入） */
    actualMin: numeric('actual_min', { precision: 6, scale: 2 }),
    eventJson: jsonb('event_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_record_session_idx').on(t.sessionId, t.occurredAt)],
);

/** 课堂模式手册 8.1 的六指标落库 */
export const observation = pgTable(
  'observation',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => classSession.id, { onDelete: 'cascade' }),
    studentId: text('student_id').notNull(),
    /** 开口次数 */
    speakCount: integer('speak_count').notNull().default(0),
    /** 被单独问过次数（M5 轮巡覆盖） */
    patrolCount: integer('patrol_count').notNull().default(0),
    /** 卡住次数 */
    stuckCount: integer('stuck_count').notNull().default(0),
    /** 任务单完成率 0–1 */
    taskCompletion: numeric('task_completion', { precision: 4, scale: 3 }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('observation_session_student_uq').on(t.sessionId, t.studentId)],
);

/* ══════════════════════════════════════════════════════════
 * 价值层 · 家长可见
 * ══════════════════════════════════════════════════════════ */

export const guardian = pgTable(
  'guardian',
  {
    id: text('id').primaryKey(),
    /** 手机号是家长端的唯一登录主体 */
    phone: text('phone').notNull(),
    name: text('name').notNull(),
    smsVerifiedAt: timestamp('sms_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('guardian_phone_uq').on(t.phone)],
);

/**
 * 学员子身份 —— 无密码、无开放注册。
 * 说明：设计方案 4.1 里 `student` 与 `student_identity` 两张表字段高度重叠，
 * 这里合并为一张（映射见 docs/数据模型.md）。
 */
export const student = pgTable(
  'student',
  {
    id: text('id').primaryKey(),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardian.id),
    /** 昵称制，不采集真实姓名与正脸照 */
    displayName: text('display_name').notNull(),
    avatarKey: text('avatar_key').notNull(),
    /** 头像装备随 GRADE_L1 → GRADE_L3 升级 */
    avatarStage: integer('avatar_stage').notNull().default(1),
    grade: integer('grade').notNull(),
    levelId: text('level_id').references(() => level.id),
    badge: jsonb('badge').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** ACTIVE / GRADUATED / DEACTIVATED —— 结业不注销账号 */
    state: text('state').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('student_guardian_idx').on(t.guardianId)],
);

export const term = pgTable('term', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  levelId: text('level_id')
    .notNull()
    .references(() => level.id),
  /** 首期开班日期待人工拍板（Q7）→ 存 NULL，不编造（C13） */
  startDate: date('start_date'),
  endDate: date('end_date'),
  /** PLANNED / RUNNING / CLOSED */
  status: text('status').notNull().default('PLANNED'),
});

export const enrollment = pgTable(
  'enrollment',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id),
    termId: text('term_id').references(() => term.id),
    /** 课包档期待定（业务侧） */
    packageType: text('package_type'),
    totalLessons: integer('total_lessons'),
    usedLessons: integer('used_lessons').notNull().default(0),
    /** 报价按 ≥2 人小班重定 —— 未定稿前为 NULL，不沿用旧价也不自行推算（C13） */
    price: numeric('price', { precision: 10, scale: 2 }),
    /** ACTIVE / COMPLETED / CANCELLED */
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('enrollment_student_idx').on(t.studentId)],
);

/** 学生产出 —— 家长可见物 */
export const artifact = pgTable(
  'artifact',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').references(() => classSession.id),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id),
    lessonId: text('lesson_id').references(() => lesson.id),
    /** 作品 / 任务单 / 测评 / 证书 */
    artifactType: text('artifact_type').notNull(),
    title: text('title').notNull(),
    contentJson: jsonb('content_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    storageKey: text('storage_key'),
    /** VIS_L0 私密 / VIS_L1 本班 / VIS_L2 跨期 / VIS_L3 对外 */
    visibility: text('visibility').notNull().default('VIS_L0'),
    wallApproved: boolean('wall_approved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('artifact_student_idx').on(t.studentId, t.createdAt),
    index('artifact_session_idx').on(t.sessionId),
  ],
);

/**
 * 「谁看过」—— 一行一次访问，只记人与关系。
 * ⚠️ 这里刻意没有 view_count 列：孩子能看到「谁看过」但不显示任何数字（C8）。
 */
export const artifactView = pgTable(
  'artifact_view',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'cascade' }),
    viewerStudentId: text('viewer_student_id'),
    viewerGuardianId: text('viewer_guardian_id'),
    /** 本人 / 讲师 / 家长 / 同班同学 */
    relation: text('relation').notNull(),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('artifact_view_artifact_idx').on(t.artifactId, t.viewedAt)],
);

/** 展位条目 —— 一件作品可由多个结果组成 */
export const showcase = pgTable(
  'showcase',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id),
    sessionId: text('session_id').references(() => classSession.id),
    artifactId: text('artifact_id').references(() => artifact.id),
    title: text('title').notNull(),
    visibility: text('visibility').notNull().default('VIS_L0'),
    wallApproved: boolean('wall_approved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('showcase_student_idx').on(t.studentId, t.createdAt)],
);

/** 跨期正向留言 —— 只准三类句式 */
export const peerNote = pgTable(
  'peer_note',
  {
    id: text('id').primaryKey(),
    showcaseId: text('showcase_id')
      .notNull()
      .references(() => showcase.id, { onDelete: 'cascade' }),
    fromStudentId: text('from_student_id')
      .notNull()
      .references(() => student.id),
    /** 注意到 / 喜欢 / 想问 */
    noteType: text('note_type').notNull(),
    content: text('content').notNull(),
    /** PENDING / APPROVED / REJECTED —— 是否先审后放待拍板（Q5） */
    reviewState: text('review_state').notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('peer_note_showcase_idx').on(t.showcaseId, t.createdAt)],
);

/** 授权留痕 —— 逐件可撤回（C10） */
export const visibilityGrant = pgTable(
  'visibility_grant',
  {
    id: text('id').primaryKey(),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardian.id),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id),
    /** VIS_L1 / VIS_L2 / VIS_L3 */
    scope: text('scope').notNull(),
    /** 为空表示整档授权；不为空表示逐件授权 */
    artifactId: text('artifact_id').references(() => artifact.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('visibility_grant_student_idx').on(t.studentId, t.scope)],
);

/** 知情同意 —— 可撤回（C11） */
export const consent = pgTable(
  'consent',
  {
    id: text('id').primaryKey(),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardian.id),
    studentId: text('student_id').references(() => student.id),
    /** 作品上墙 / 影像 / 数据 / 跨期 */
    scope: text('scope').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('consent_guardian_idx').on(t.guardianId)],
);

/** 每 4 节课的家长反馈 + 结课摘要 */
export const studentFeedback = pgTable(
  'student_feedback',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => classSession.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id),
    content: text('content').notNull(),
    teacherComment: text('teacher_comment'),
    nextStep: text('next_step'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('student_feedback_student_idx').on(t.studentId, t.createdAt)],
);

export const classSessionParticipant = pgTable(
  'class_session_participant',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => classSession.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => student.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('class_session_participant_uq').on(t.sessionId, t.studentId)],
);
