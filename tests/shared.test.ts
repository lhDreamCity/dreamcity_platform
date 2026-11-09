import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASE_MINUTES,
  GRADE_META,
  GRADE_LEVELS,
  MAX_LECTURE_MINUTES,
  MIN_PARTICIPANT_COUNT,
  MODE_META,
  PHASES,
  VISIBILITY_META,
  VISIBILITY_SCOPES,
  coerceResultPayload,
  isActivityResultMessage,
  parseLessonId,
  scopeRank,
  validateManifest,
} from '@dreamcity/shared';

describe('枚举与术语', () => {
  it('课程级别用 GRADE_ 前缀，可见范围用 VIS_ 前缀，两者不混', () => {
    for (const g of GRADE_LEVELS) expect(g).toMatch(/^GRADE_L[123]$/);
    for (const v of VISIBILITY_SCOPES) expect(v).toMatch(/^VIS_L[0-3]$/);
  });

  it('级别与可见范围是两组不同的取值（命名陷阱）', () => {
    // GRADE_L1 与 VIS_L1 是两件事，绝不能互相赋值
    expect(GRADE_LEVELS).not.toContain('VIS_L1' as never);
    expect(VISIBILITY_SCOPES).not.toContain('GRADE_L1' as never);
  });

  it('五环节合计 90 分钟', () => {
    const total = PHASES.reduce((sum, p) => sum + DEFAULT_PHASE_MINUTES[p], 0);
    expect(total).toBe(90);
  });

  it('讲授上限是 25 分钟', () => {
    expect(MAX_LECTURE_MINUTES).toBe(25);
  });

  it('班型下限是 2 人', () => {
    expect(MIN_PARTICIPANT_COUNT).toBe(2);
  });

  it('M5 / M6 标记为必须真人', () => {
    expect(MODE_META.MODE_M5.teacherOnly).toBe(true);
    expect(MODE_META.MODE_M6.teacherOnly).toBe(true);
    expect(MODE_META.MODE_M1.teacherOnly).toBe(false);
  });

  it('每张模式卡都带失效信号', () => {
    for (const m of Object.values(MODE_META)) {
      expect(m.failureSignal.length).toBeGreaterThan(0);
    }
  });

  it('可见范围默认最小、逐级放宽', () => {
    expect(VISIBILITY_META.VIS_L0.isDefault).toBe(true);
    expect(VISIBILITY_META.VIS_L0.perItemGrant).toBe(false);
    expect(VISIBILITY_META.VIS_L3.perItemGrant).toBe(true);
    expect(VISIBILITY_META.VIS_L3.watermark).toBe(true);
    expect(scopeRank('VIS_L0')).toBeLessThan(scopeRank('VIS_L3'));
  });

  it('课次 id 解析出级别与节次', () => {
    expect(parseLessonId('L1-01')).toEqual({ grade: 'GRADE_L1', seq: 1 });
    expect(parseLessonId('L3-16')).toEqual({ grade: 'GRADE_L3', seq: 16 });
    expect(parseLessonId('X1-01')).toBeNull();
  });

  it('级别元信息完整', () => {
    for (const g of GRADE_LEVELS) {
      expect(GRADE_META[g].gradeRange.length).toBeGreaterThan(0);
      expect(GRADE_META[g].theme.length).toBeGreaterThan(0);
    }
  });
});

describe('插件 manifest 校验', () => {
  const valid = {
    id: 'demo-plugin',
    name: '演示插件',
    version: '1.0.0',
    lesson_refs: ['L1-01'],
    mode_cards: ['MODE_M2' as const],
    duration_min: 10,
    entry: 'demo.html',
    standalone: true,
    result_schema: { score: 'number' as const },
    artifact_fields: ['score'],
    offline_fallback: '任务单 P01（打印版）',
  };

  it('合法 manifest 通过', () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
    expect(r.manifest?.id).toBe('demo-plugin');
  });

  it('缺少 offline_fallback 不通过（设备故障时课堂不能停）', () => {
    const { offline_fallback, ...without } = valid;
    expect(offline_fallback).toBeTruthy();
    const r = validateManifest(without);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === 'offline_fallback')).toBe(true);
  });

  it('artifact_fields 必须在 result_schema 里声明', () => {
    const r = validateManifest({ ...valid, artifact_fields: ['not_declared'] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.startsWith('artifact_fields'))).toBe(true);
  });

  it('lesson_refs 必须是 L1-01 这样的课次号', () => {
    const r = validateManifest({ ...valid, lesson_refs: ['GRADE_L1'] });
    expect(r.ok).toBe(false);
  });
});

describe('结果回传协议', () => {
  const schema = {
    score: 'number' as const,
    name: 'string' as const,
    tags: 'string[]' as const,
    ok: 'boolean' as const,
  };

  it('字段类型不符时报错', () => {
    const r = coerceResultPayload({ score: 'high', name: 'a', tags: [], ok: true }, schema);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('score'))).toBe(true);
  });

  it('不在 schema 里的字段被丢弃', () => {
    const r = coerceResultPayload({ score: 1, name: 'a', tags: [], ok: true, secret: 'x' }, schema);
    expect(r.ok).toBe(true);
    expect(r.value.secret).toBeUndefined();
  });

  it('可选字段缺失不算错', () => {
    const r = coerceResultPayload({ score: 1 }, { score: 'number' as const, task_completion: 'number' as const }, [
      'task_completion',
    ]);
    expect(r.ok).toBe(true);
  });

  it('必填字段缺失算错', () => {
    const r = coerceResultPayload({ score: 1 }, { score: 'number' as const, profit: 'number' as const });
    expect(r.ok).toBe(false);
  });

  it('只认规范的回传消息', () => {
    expect(
      isActivityResultMessage({
        type: 'dreamcity:activity:result',
        activityId: 'a',
        sessionId: 's',
        studentId: null,
        payload: {},
        visibility: 'VIS_L0',
        ts: 1,
      }),
    ).toBe(true);
    expect(isActivityResultMessage({ type: 'other' })).toBe(false);
    expect(isActivityResultMessage(null)).toBe(false);
  });
});
