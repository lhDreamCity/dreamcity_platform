/**
 * 活动插件规范 —— 承自《梦之城综合教学平台设计方案 V1.1》§5
 *
 * 活动 = 独立单文件 HTML + manifest + postMessage 结果回传
 *
 * 五条硬约束（设计方案 §5.3），每条都有自动化检查：
 *  1. 单文件、零外部 CDN、零后端请求
 *  2. 结果必须可序列化且符合 result_schema
 *  3. 必须提供 offline_fallback（打印版任务单）
 *  4. 作品回传必须带 visibility；不采集真实姓名、位置与设备指纹
 *  5. 支持 prefers-reduced-motion，移动端可降级
 */

import type { GradeLevel, ModeCard, VisibilityScope } from './enums.js';

/* ────────────────────────────────────────────────────────────
 * manifest
 * ──────────────────────────────────────────────────────────── */

export type ResultFieldType = 'number' | 'string' | 'boolean' | 'string[]' | 'object';

export interface ActivityManifest {
  id: string;
  name: string;
  version: string;
  /** 适配的课次，如 ['L1-10', 'L2-10'] */
  lesson_refs: string[];
  /** 服务的模式卡 */
  mode_cards: ModeCard[];
  /** 建议时长（分钟） */
  duration_min: number;
  /** 相对 activities/ 的入口文件 */
  entry: string;
  /** 是否可脱离宿主独立打开（招生演示用） */
  standalone: boolean;
  /** 结果字段 schema */
  result_schema: Record<string, ResultFieldType>;
  /** 哪些字段落库为作品（artifact） */
  artifact_fields: string[];
  /** 可选结果字段：缺失不算错（其余字段缺失则拒绝回传） */
  result_optional?: string[];
  /** 设备故障时的兜底：打印版任务单编号 */
  offline_fallback: string;
  /** 适用级别 */
  grades?: GradeLevel[];
  /** 降级到 2D 时使用同一套场景状态与教学逻辑 */
  fallback_2d?: boolean;
}

export interface ManifestValidationIssue {
  path: string;
  message: string;
}

/** manifest 运行时校验器 —— 注册插件时服务端会跑一遍 */
export function validateManifest(input: unknown): {
  ok: boolean;
  manifest?: ActivityManifest;
  issues: ManifestValidationIssue[];
} {
  const issues: ManifestValidationIssue[] = [];
  const m = (input ?? {}) as Partial<ActivityManifest>;

  if (!m.id || !/^[a-z0-9-]{3,64}$/.test(m.id)) {
    issues.push({ path: 'id', message: 'id 必须是 3–64 位小写字母/数字/连字符' });
  }
  if (!m.name) issues.push({ path: 'name', message: '缺少 name' });
  if (!m.version) issues.push({ path: 'version', message: '缺少 version' });
  if (!Array.isArray(m.lesson_refs)) issues.push({ path: 'lesson_refs', message: 'lesson_refs 必须是数组' });
  if (!Array.isArray(m.mode_cards) || m.mode_cards.length === 0) {
    issues.push({ path: 'mode_cards', message: 'mode_cards 至少要有一张模式卡' });
  }
  if (typeof m.duration_min !== 'number' || m.duration_min <= 0) {
    issues.push({ path: 'duration_min', message: 'duration_min 必须是正数' });
  }
  if (!m.entry || !/^[\w./-]+\.html$/.test(m.entry)) {
    issues.push({ path: 'entry', message: 'entry 必须是相对路径的 .html 文件' });
  }
  if (!m.result_schema || typeof m.result_schema !== 'object') {
    issues.push({ path: 'result_schema', message: 'result_schema 必须是对象' });
  }
  if (!Array.isArray(m.artifact_fields)) {
    issues.push({ path: 'artifact_fields', message: 'artifact_fields 必须是数组' });
  }
  if (!m.offline_fallback) {
    issues.push({ path: 'offline_fallback', message: '缺少 offline_fallback（设备故障时课堂不能停）' });
  }
  if (!Array.isArray(m.lesson_refs) || m.lesson_refs.some((r) => !/^L[123]-\d{2}$/.test(r))) {
    issues.push({ path: 'lesson_refs', message: 'lesson_refs 的每一项必须形如 L1-01' });
  }
  if (m.artifact_fields && m.result_schema) {
    for (const f of m.artifact_fields) {
      if (!(f in m.result_schema)) {
        issues.push({ path: `artifact_fields.${f}`, message: '该字段未在 result_schema 中声明' });
      }
    }
  }

  return issues.length === 0
    ? { ok: true, manifest: m as ActivityManifest, issues }
    : { ok: false, issues };
}

/* ────────────────────────────────────────────────────────────
 * postMessage 协议
 * ──────────────────────────────────────────────────────────── */

/** 驾驶舱 → 插件：握手并注入上下文 */
export const HOST_INIT_MESSAGE = 'dreamcity:host:init' as const;

/** 插件 → 驾驶舱：回传结果 */
export const ACTIVITY_RESULT_MESSAGE = 'dreamcity:activity:result' as const;

/** 插件 → 驾驶舱：报告阶段推进（可选，用于时间轴细分） */
export const ACTIVITY_PROGRESS_MESSAGE = 'dreamcity:activity:progress' as const;

export interface HostInitPayload {
  sessionId: string;
  /** 大屏共用时为空 */
  studentId: string | null;
  studentNickname: string | null;
  activityId: string;
  /** 学员级别：插件据此开放不同难度（如变量实验室的三级别变量权限） */
  level: GradeLevel | null;
  /** 插件所在页面的 origin，用于宿主校验来源 */
  origin: string;
}

export interface ActivityResultPayload {
  score?: number;
  final_price?: number;
  profit?: number;
  rounds?: number;
  badges?: string[];
  [key: string]: unknown;
}

export interface ActivityResultMessage {
  type: typeof ACTIVITY_RESULT_MESSAGE;
  activityId: string;
  sessionId: string;
  studentId: string | null;
  payload: ActivityResultPayload;
  /** 默认 VIS_L0，由平台按授权逐级放开 */
  visibility: VisibilityScope;
  ts: number;
}

export function isActivityResultMessage(data: unknown): data is ActivityResultMessage {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<ActivityResultMessage>;
  return (
    d.type === ACTIVITY_RESULT_MESSAGE &&
    typeof d.activityId === 'string' &&
    typeof d.sessionId === 'string' &&
    typeof d.visibility === 'string' &&
    typeof d.ts === 'number'
  );
}

export function isHostInitMessage(data: unknown): data is HostInitPayload & { type: string } {
  if (!data || typeof data !== 'object') return false;
  return (data as { type?: string }).type === HOST_INIT_MESSAGE;
}

/**
 * 校验结果 payload 是否符合 manifest 声明的 result_schema。
 * 返回「规范化后的 payload」：不在 schema 里的字段被丢弃（约束 2）。
 * `optionalFields` 里的字段缺失不算错。
 */
export function coerceResultPayload(
  payload: unknown,
  schema: Record<string, ResultFieldType>,
  optionalFields: string[] = [],
): { ok: boolean; value: ActivityResultPayload; issues: string[] } {
  const issues: string[] = [];
  const out: ActivityResultPayload = {};
  const optional = new Set(optionalFields);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, value: {}, issues: ['payload 必须是对象'] };
  }
  const src = payload as Record<string, unknown>;
  for (const [key, type] of Object.entries(schema)) {
    const v = src[key];
    if (v === undefined || v === null) {
      if (!optional.has(key)) issues.push(`缺少字段 ${key}`);
      continue;
    }
    switch (type) {
      case 'number':
        if (typeof v !== 'number' || Number.isNaN(v)) {
          issues.push(`字段 ${key} 应为 number`);
          continue;
        }
        out[key] = v;
        break;
      case 'string':
        if (typeof v !== 'string') {
          issues.push(`字段 ${key} 应为 string`);
          continue;
        }
        out[key] = v;
        break;
      case 'boolean':
        if (typeof v !== 'boolean') {
          issues.push(`字段 ${key} 应为 boolean`);
          continue;
        }
        out[key] = v;
        break;
      case 'string[]':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
          issues.push(`字段 ${key} 应为 string[]`);
          continue;
        }
        out[key] = v as string[];
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) {
          issues.push(`字段 ${key} 应为 object`);
          continue;
        }
        out[key] = v;
        break;
    }
  }
  return { ok: issues.length === 0, value: out, issues };
}
