/**
 * 前后端共享的 API 契约
 * 三端（讲师 / 家长 / 学生）都从这里取类型，避免各写各的。
 */

import type { ActivityManifest } from './plugin.js';
import type {
  Atom,
  GradeLevel,
  ModeCard,
  Phase,
  VisibilityScope,
} from './enums.js';

/* ── 身份 ──────────────────────────────────────────────────── */

export type StaffRole = 'TEACHER' | 'OPS' | 'ADMIN';

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

export interface GuardianProfile {
  id: string;
  name: string;
  phone: string;
}

export interface StudentProfile {
  id: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  grade: number;
  levelId: GradeLevel | null;
  badge: string[];
  /** 监护人同意状态（家长端可见，可随时撤回） */
  consents?: ConsentState;
}

/* ── 模板层 ────────────────────────────────────────────────── */

export interface LevelDto {
  id: GradeLevel;
  code: string;
  name: string;
  gradeRange: string;
  theme: string;
  seq: number;
}

export interface UnitDto {
  id: string;
  levelId: GradeLevel;
  seq: number;
  name: string;
}

/** 细案十字段 + 五环节（原文入库，不改写） */
export interface LessonPlanContent {
  teachingGoal: string;
  coreContent: string;
  segments: { phase: Phase; minutes: number; activity: string }[];
  keyQuestion: string;
  classTask: string;
  classOutput: string;
  dualityLink: string;
  criteria: string;
  pitfalls: string;
  homework: string;
}

export interface LessonDto {
  id: string;
  unitId: string;
  levelId: GradeLevel;
  seq: number;
  title: string;
  output: string;
  currentVersion: number;
  plan: LessonPlanContent;
  defaultRecipe: string | null;
}

export interface LessonVersionDto {
  id: string;
  lessonId: string;
  version: number;
  note: string | null;
  createdAt: string;
}

export interface PluginDto {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  manifest: ActivityManifest;
}

/* ── 实例层 ────────────────────────────────────────────────── */

export type SessionState = 'DRAFT' | 'LIVE' | 'CLOSED';

export type ActivityKind = 'LESSON_PDF' | 'PLUGIN' | 'VOTE' | 'TASK' | 'SUBMIT' | 'BREAK';

export interface SessionActivityDto {
  id: string;
  seq: number;
  phase: Phase;
  modeCard: ModeCard | null;
  atom: Atom | null;
  title: string;
  durationMin: number;
  pluginId: string | null;
  resourceId: string | null;
  activityKind: ActivityKind;
}

export interface ParticipantDto {
  studentId: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  /** 本节被单独问过次数（M5 轮巡覆盖） */
  askedCount: number;
  joinedAt: string | null;
}

export interface PhaseTimingDto {
  phase: Phase;
  plannedMin: number;
  actualMin: number;
  /** 实耗秒数：分钟粒度在刚开始的环节会显示 0，秒数让讲师看得到「在走」 */
  actualSec: number;
  startedAt: string | null;
  endedAt: string | null;
  isCurrent: boolean;
}

export interface CockpitStateDto {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  state: SessionState;
  classCode: string | null;
  startedAt: string | null;
  elapsedMin: number;
  participantCount: number;
  phases: PhaseTimingDto[];
  activities: SessionActivityDto[];
  participants: ParticipantDto[];
  currentActivityId: string | null;
  /** 断网兜底提示（当前活动的打印版任务单） */
  offlineFallback: string | null;
}

export interface SessionSummaryDto {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  startedAt: string | null;
  endedAt: string | null;
  totalActualMin: number;
  artifactCount: number;
  participants: number;
  /** 结课摘要（讲师一键确认后发家长） */
  draft: string;
}

export interface ClassSessionDto {
  id: string;
  lessonId: string;
  lessonTitle: string;
  levelId: GradeLevel;
  state: SessionState;
  classCode: string | null;
  participantCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

/* ── 价值层 ────────────────────────────────────────────────── */

export type ArtifactType = '作品' | '任务单' | '测评' | '证书';

export interface ArtifactDto {
  id: string;
  studentId: string;
  studentName: string;
  sessionId: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
  type: ArtifactType;
  title: string;
  content: Record<string, unknown>;
  visibility: VisibilityScope;
  wallApproved: boolean;
  createdAt: string;
  /** 谁看过（只列人名与关系，不显示任何数字 —— C8） */
  viewers: { name: string; relation: string }[];
  /** 收到的留言 */
  notes: PeerNoteDto[];
}

export type PeerNoteType = '注意到' | '喜欢' | '想问';

export interface PeerNoteDto {
  id: string;
  showcaseId: string;
  fromStudentId: string;
  fromStudentName: string;
  noteType: PeerNoteType;
  content: string;
  reviewState: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export interface ShowcaseItemDto {
  id: string;
  studentId: string;
  studentName: string;
  avatarKey: string;
  avatarStage: number;
  title: string;
  visibility: VisibilityScope;
  artifactId: string | null;
  createdAt: string;
  /** 本人 / 同伴 / 家长视角下能看到的留言 */
  notes: PeerNoteDto[];
  /** 「谁看过」—— 名字列表，无数字 */
  viewedBy: { name: string; relation: string }[];
}

export interface StudentFeedbackDto {
  id: string;
  sessionId: string;
  studentId: string;
  lessonTitle: string;
  content: string;
  teacherComment: string | null;
  nextStep: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface GrowthProfileDto {
  studentId: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  levelId: GradeLevel | null;
  grade: number;
  badge: string[];
  completedLessons: number;
  totalLessons: number | null;
  remainingLessons: number | null;
  artifacts: number;
}

export interface VisibilityGrantDto {
  id: string;
  scope: Exclude<VisibilityScope, 'VIS_L0'>;
  artifactId: string | null;
  artifactTitle: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

/* ── 请求体 ────────────────────────────────────────────────── */

/**
 * 监护人同意的四项（逐项勾选，可随时撤回）
 * 对应《未成年人网络保护条例》要求的最小必要与逐项授权。
 */
export interface ConsentState {
  /** 作品上墙 */
  wall: boolean;
  /** 影像 */
  media: boolean;
  /** 数据 */
  data: boolean;
  /** 跨期互评 */
  crossTerm: boolean;
}

export const CONSENT_SCOPES = ['作品上墙', '影像', '数据', '跨期'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface CreateChildBody {
  /** 昵称，≤10 字，不写真实姓名 */
  displayName: string;
  /** 年级 3–9 */
  grade: number;
  avatarKey: string;
  consents: ConsentState;
}

export interface StudentDirectoryRow {
  id: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  grade: number;
  levelId: string | null;
  /** 家长姓名（讲师需要知道是谁家的孩子） */
  guardianName: string;
  /** 手机号后四位，用于口头核对 */
  phoneTail: string;
  /** 是否已加入过课堂 */
  inSession: boolean;
}

export interface AddParticipantBody {
  studentId: string;
}

export interface StaffLoginBody {
  email: string;
  password: string;
}

export interface GuardianSendCodeBody {
  phone: string;
}

export interface GuardianLoginBody {
  phone: string;
  code: string;
}

export interface StudentEnterBody {
  classCode: string;
}

export interface StudentPickBody {
  classCode: string;
  studentId: string;
}

export interface CaptureBody {
  studentId: string;
  /** 完成 / 卡住 / 已单独问过 */
  kind: '完成' | '卡住' | '已单独问过';
}

export interface SubmitResultBody {
  activityId: string;
  payload: Record<string, unknown>;
  visibility: VisibilityScope;
  studentId?: string | null;
}

export interface CreateSessionBody {
  lessonId: string;
  roomName: string;
  participantCount: number;
  termId?: string;
}

export interface SessionActivityBody {
  seq?: number;
  phase: Phase;
  modeCard?: ModeCard | null;
  atom?: Atom | null;
  title: string;
  durationMin: number;
  pluginId?: string | null;
  resourceId?: string | null;
  activityKind: ActivityKind;
}

export interface GrantBody {
  studentId: string;
  scope: Exclude<VisibilityScope, 'VIS_L0'>;
  artifactId?: string | null;
}

export interface PeerNoteBody {
  showcaseId: string;
  noteType: PeerNoteType;
  content: string;
}

/* ── 通用响应 ──────────────────────────────────────────────── */

export interface ApiError {
  error: string;
  message: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}
