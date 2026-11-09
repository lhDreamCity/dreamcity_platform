import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

describe('48 节课入库数据', () => {
  const lessons = JSON.parse(
    readFileSync(join(ROOT, 'content/lessons.json'), 'utf8'),
  ) as {
    lessonCount: number;
    lessons: {
      id: string;
      level: string;
      seq: number;
      title: string;
      unitId: string;
      defaultRecipe: string;
      totalMinutes: number;
      canonicalMinutes: Record<string, number>;
      plan: Record<string, unknown>;
    }[];
  };

  it('48 节，三个级别各 16 节', () => {
    expect(lessons.lessonCount).toBe(48);
    expect(lessons.lessons.length).toBe(48);
    for (const lv of ['L1', 'L2', 'L3']) {
      expect(lessons.lessons.filter((l) => l.level === lv).length).toBe(16);
    }
  });

  it('每节课都有十字段与五环节', () => {
    const FIELDS = [
      'teachingGoal',
      'coreContent',
      'keyQuestion',
      'classTask',
      'classOutput',
      'dualityLink',
      'criteria',
      'pitfalls',
      'homework',
    ];
    for (const l of lessons.lessons) {
      for (const f of FIELDS) {
        expect(l.plan[f], `${l.id}.${f}`).toBeTruthy();
      }
      expect((l.plan.segments as unknown[]).length, l.id).toBe(5);
    }
  });

  it('节次连续且不重号', () => {
    for (const lv of ['L1', 'L2', 'L3']) {
      const seqs = lessons.lessons
        .filter((l) => l.level === lv)
        .map((l) => l.seq)
        .sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    }
  });

  it('每级 4 个单元，边界是 1–4 / 5–8 / 9–12 / 13–16', () => {
    for (const lv of ['L1', 'L2', 'L3']) {
      const units = new Map<string, number[]>();
      for (const l of lessons.lessons.filter((x) => x.level === lv)) {
        const arr = units.get(l.unitId) ?? [];
        arr.push(l.seq);
        units.set(l.unitId, arr);
      }
      expect(units.size).toBe(4);
      const sorted = [...units.values()].map((v) => v.sort((a, b) => a - b));
      expect(sorted).toEqual([
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
      ]);
    }
  });

  it('归一后的五环节合计等于原文合计', () => {
    for (const l of lessons.lessons) {
      const sum = Object.values(l.canonicalMinutes).reduce((a, b) => a + b, 0);
      expect(sum, l.id).toBe(l.totalMinutes);
    }
  });

  it('绝大多数课次 90 分钟；结业日与路演日原文就是 100 分钟', () => {
    const totals = new Map<string, number>();
    for (const l of lessons.lessons) totals.set(l.id, l.totalMinutes);
    expect(totals.get('L1-16')).toBe(100);
    expect(totals.get('L2-16')).toBe(100);
    expect(totals.get('L3-16')).toBe(90);
  });
});

describe('活动插件清单', () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'activities/manifest.json'), 'utf8'),
  ) as {
    plugins: {
      id: string;
      entry: string;
      lesson_refs: string[];
      mode_cards: string[];
      result_schema: Record<string, string>;
      artifact_fields: string[];
      offline_fallback: string;
    }[];
  };

  it('每个插件都有入口文件、兜底方案与结果 schema', () => {
    for (const p of manifest.plugins) {
      expect(p.offline_fallback.length).toBeGreaterThan(0);
      expect(Object.keys(p.result_schema).length).toBeGreaterThan(0);
      expect(p.artifact_fields.length).toBeGreaterThan(0);
      expect(p.mode_cards.length).toBeGreaterThan(0);
    }
  });

  it('入口文件真实存在', () => {
    for (const p of manifest.plugins) {
      const path = join(ROOT, 'activities', p.entry);
      expect(() => readFileSync(path, 'utf8')).not.toThrow();
    }
  });

  it('artifact_fields 都在 result_schema 里', () => {
    for (const p of manifest.plugins) {
      for (const f of p.artifact_fields) {
        expect(p.result_schema[f], `${p.id}.${f}`).toBeTruthy();
      }
    }
  });
});

describe('插件 HTML：单文件、零外部请求', () => {
  const dir = join(ROOT, 'activities');
  const files = readdirSync(dir).filter((f) => f.endsWith('.html'));

  it('至少有一个活动', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('不引用任何外部地址', () => {
    for (const f of files) {
      const html = readFileSync(join(dir, f), 'utf8');
      const withoutComments = html
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(withoutComments.match(/https?:\/\//g), f).toBeNull();
    }
  });

  it('都实现了与宿主的握手与结果回传', () => {
    for (const f of files) {
      const html = readFileSync(join(dir, f), 'utf8');
      expect(html, f).toContain('dreamcity:host:init');
      expect(html, f).toContain('dreamcity:activity:result');
    }
  });
});
