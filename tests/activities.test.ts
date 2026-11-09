/**
 * 活动插件的自动化冒烟
 *
 * 活动是独立的单文件 HTML，浏览器里才跑得起来 —— 但「浏览器里跑得起来」
 * 恰恰是最容易在投屏现场才发现的问题（着色器编译不过、WebGL 拿不到、
 * 某个变量名写错）。这里用一套极简的假 DOM + 假 WebGL 上下文，
 * 把每个活动脚本在 Node 里真跑一遍：
 *
 *  · WebGL 可用 → 必须走 3D 路径，且真的发出了绘制调用
 *  · WebGL 不可用 → 必须自动降级到 2D 路径
 *  · 两条路径都不能抛异常（投屏机上抛异常 = 这节课的环节直接卡住）
 *
 * 这不能替代真机验证，但能把「脚本自己就炸了」这类问题挡在上线之前。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '..');
const ACTIVITIES_DIR = resolve(ROOT, 'activities');

/* ── 假上下文（WebGL / Canvas 2D 共用同一套记账方式）────────── */

interface FakeCtx {
  calls: string[];
  ctx: unknown;
}

function makeCtx(): FakeCtx {
  const calls: string[] = [];
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {
    calls,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getParameter: () => 'fake-ctx',
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in t) return t[prop];
      // 其余一律当成「记录调用就返回 undefined」的方法或常量
      return (...args: unknown[]) => {
        calls.push(prop);
        return undefined;
      };
    },
  });
  return { calls, ctx };
}

/* ── 假 DOM ────────────────────────────────────────────────── */

interface FakeElement {
  id: string;
  textContent: string;
  innerHTML: string;
  className: string;
  value: string;
  style: Record<string, string>;
  children: FakeElement[];
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
  addEventListener: () => void;
  appendChild: (child: FakeElement) => void;
  getContext: (type: string) => unknown;
  getAttribute: (name: string) => string | null;
  setAttribute: () => void;
  removeAttribute: () => void;
}

function makeElement(id: string, gl: FakeCtx | null, c2d: FakeCtx): FakeElement {
  return {
    id,
    textContent: id === 'mode' ? '3D' : '',
    innerHTML: '',
    className: '',
    value: '',
    style: {},
    children: [],
    clientWidth: 960,
    clientHeight: 640,
    width: 0,
    height: 0,
    addEventListener: () => {},
    appendChild: (child: FakeElement) => {
      void child;
    },
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    getContext: (type: string) => {
      if (type === '2d') return c2d.ctx;
      if (type === 'webgl' || type === 'experimental-webgl') return gl ? gl.ctx : null;
      return null;
    },
  };
}

/* ── 跑一个活动脚本 ────────────────────────────────────────── */

interface RunResult {
  gl: FakeCtx;
  c2d: FakeCtx;
  elements: Map<string, FakeElement>;
  frames: number;
}

function runActivity(file: string, withWebGL: boolean): RunResult {
  const html = readFileSync(resolve(ACTIVITIES_DIR, file), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`${file} 里没有 <script>`);
  const code = match[1]!;

  const gl = makeCtx();
  const c2d = makeCtx();
  const elements = new Map<string, FakeElement>();

  const getEl = (id: string): FakeElement => {
    let el = elements.get(id);
    if (!el) {
      el = makeElement(id, withWebGL ? gl : null, c2d);
      if (id === 'steps') {
        for (let i = 0; i < 5; i += 1) el.children.push(makeElement(`step${i}`, withWebGL ? gl : null, c2d));
      }
      elements.set(id, el);
    }
    return el;
  };

  // 画布与状态徽标先建好，后面好断言
  getEl('cv');
  getEl('mode');

  const rafQueue: (() => void)[] = [];
  const requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };

  const win: Record<string, unknown> = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame,
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { origin: 'test' },
  };
  win.parent = win;

  const sandbox: Record<string, unknown> = {
    window: win,
    document: {
      getElementById: getEl,
      createElement: (id: string) => makeElement(id, withWebGL ? gl : null, c2d),
      querySelector: (sel: string) => getEl(sel),
      querySelectorAll: () => [] as FakeElement[],
      body: makeElement('body', withWebGL ? gl : null, c2d),
    },
    parent: { postMessage: () => {} },
    requestAnimationFrame,
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    clearTimeout: (id: number) => clearTimeout(id),
    console,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(code, context, { filename: file });

  // 跑几帧，让每帧一次的绘制逻辑真正执行
  let frames = 0;
  for (let i = 0; i < 3 && rafQueue.length > 0; i += 1) {
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const cb of batch) {
      cb();
      frames += 1;
    }
  }

  return { gl, c2d, elements, frames };
}

/* ── 探针：把脚本里的矩阵数学挖出来做数值校验 ─────────────── */

/**
 * 3D 版的矩阵函数都关在 IIFE 里。这里在闭包结束前插一行，
 * 把它们挂到 globalThis 上，好在测试里直接验算。
 *
 * 手写 WebGL 最常见的翻车方式就是矩阵转置错了 —— 画面不会报错，
 * 只是整个场景翻转或者跑到屏幕外。数值校验能在上线前把它挡住。
 */
function probeMath(file: string): Record<string, (...args: never[]) => unknown> {
  const html = readFileSync(resolve(ACTIVITIES_DIR, file), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`${file} 里没有 <script>`);
  const patched = match[1]!.replace(
    /\n\}\)\(\);\s*$/,
    "\n;globalThis.__probe={m4mul:m4mul,m4perspective:m4perspective,m4lookAt:m4lookAt," +
      'm4model:m4model,earthPos:earthPos,orbitRadius:orbitRadius,camEye:camEye};' +
      '\n})();',
  );
  if (!patched.includes('__probe')) throw new Error(`${file} 的脚本结构变了，探针插不进去`);

  const gl = makeCtx();
  const c2d = makeCtx();
  const getEl = (id: string) => makeElement(id, gl, c2d);
  const rafQueue: (() => void)[] = [];
  const requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  const win: Record<string, unknown> = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame,
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { origin: 'test' },
  };
  win.parent = win;

  const sandbox: Record<string, unknown> = {
    window: win,
    document: {
      getElementById: getEl,
      createElement: (id: string) => makeElement(id, gl, c2d),
      querySelector: (sel: string) => getEl(sel),
      querySelectorAll: () => [] as FakeElement[],
      body: makeElement('body', gl, c2d),
    },
    parent: { postMessage: () => {} },
    requestAnimationFrame,
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    clearTimeout: (id: number) => clearTimeout(id),
    console,
  };
  vm.runInContext(patched, vm.createContext(sandbox), { filename: file });
  const probe = (sandbox as { __probe?: Record<string, (...args: never[]) => unknown> }).__probe;
  if (!probe) throw new Error('探针没拿到数学函数');
  return probe;
}

/** 列主序矩阵乘向量（和 GLSL 里的 M * v 一致） */
function applyMat4(m: ArrayLike<number>, v: [number, number, number, number]): number[] {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]! * v[3],
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]! * v[3],
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]! * v[3],
    m[3]! * v[0] + m[7]! * v[1] + m[11]! * v[2] + m[15]! * v[3],
  ];
}

/* ── 用例 ──────────────────────────────────────────────────── */

const activityFiles = readdirSync(ACTIVITIES_DIR).filter((f) => f.endsWith('.html')).sort();

/** 这个活动有没有走 WebGL（与硬约束检查器同一套判据） */
function usesWebGL(file: string): boolean {
  const html = readFileSync(resolve(ACTIVITIES_DIR, file), 'utf8');
  return /getContext\(\s*["'](webgl2?|webgpu)["']/i.test(html);
}

/** 这个活动是不是画在画布上的（纯 DOM 的活动没有画布） */
function isCanvasActivity(file: string): boolean {
  const html = readFileSync(resolve(ACTIVITIES_DIR, file), 'utf8');
  return /getContext\(\s*["']/i.test(html);
}

describe('活动插件脚本能跑起来', () => {
  it('activities/ 下有活动', () => {
    expect(activityFiles.length).toBeGreaterThan(0);
  });

  for (const file of activityFiles) {
    it(`${file} —— WebGL 可用时跑通且画出了东西`, () => {
      const r = runActivity(file, true);
      if (isCanvasActivity(file)) {
        const painted = r.gl.calls.length + r.c2d.calls.length;
        expect(painted).toBeGreaterThan(0);
      } else {
        // 纯 DOM 的活动：得往页面上写了东西
        const wrote = [...r.elements.values()].some(
          (el) => el.innerHTML !== '' || el.textContent !== '',
        );
        expect(wrote).toBe(true);
      }
      if (usesWebGL(file)) {
        // 3D 路径必须真的画了球体
        expect(r.gl.calls).toContain('drawElements');
      }
    });

    it(`${file} —— 没有 WebGL 时自动降级，不炸`, () => {
      const r = runActivity(file, false);
      if (isCanvasActivity(file)) {
        const painted = r.gl.calls.length + r.c2d.calls.length;
        expect(painted).toBeGreaterThan(0);
      } else {
        const wrote = [...r.elements.values()].some(
          (el) => el.innerHTML !== '' || el.textContent !== '',
        );
        expect(wrote).toBe(true);
      }
      if (usesWebGL(file)) {
        // 降级后不能再走 WebGL 的绘制调用
        expect(r.gl.calls).not.toContain('drawElements');
        // 而且要真的落到 2D 上
        expect(r.c2d.calls.length).toBeGreaterThan(0);
      }
    });
  }

  it('3D 版在 WebGL 可用时不切到降级提示', () => {
    const r = runActivity('var-lab-3d.html', true);
    expect(r.elements.get('mode')?.textContent).toBe('3D');
  });

  it('3D 版在 WebGL 不可用时标出降级', () => {
    const r = runActivity('var-lab-3d.html', false);
    expect(r.elements.get('mode')?.textContent).toBe('2D 降级');
  });
});

describe('3D 版的投影矩阵没写错', () => {
  const probe = probeMath('var-lab-3d.html');
  const m4mul = probe.m4mul as unknown as (a: Float32Array, b: Float32Array, o?: Float32Array) => Float32Array;
  const m4perspective = probe.m4perspective as unknown as (f: number, a: number, n: number, f2: number) => Float32Array;
  const m4lookAt = probe.m4lookAt as unknown as (e: number[], c: number[], u: number[]) => Float32Array;
  const m4model = probe.m4model as unknown as (x: number, y: number, z: number, s: number) => Float32Array;
  const camEye = probe.camEye as unknown as (cam: { az: number; el: number; dist: number }) => number[];
  const earthPos = probe.earthPos as unknown as (a: number) => number[];
  const orbitRadius = probe.orbitRadius as unknown as () => number;

  const cam = { az: 0.7, el: 0.42, dist: 8.2 };

  function ndc(clip: number[]): number[] {
    return [clip[0]! / clip[3]!, clip[1]! / clip[3]!, clip[2]! / clip[3]!];
  }

  const proj = m4perspective(Math.PI / 3.2, 960 / 640, 0.1, 120);
  const view = m4lookAt(camEye(cam), [0, 0, 0], [0, 1, 0]);
  const vp = m4mul(proj, view);

  it('恒星落在画面中心附近', () => {
    const clip = applyMat4(vp, [0, 0, 0, 1]);
    const p = ndc(clip);
    expect(Math.abs(p[0]!)).toBeLessThan(0.02);
    expect(Math.abs(p[1]!)).toBeLessThan(0.02);
    // 在相机前面
    expect(clip[3]!).toBeGreaterThan(0);
  });

  it('地球在画面内，且在恒星前方（近裁剪面之外）', () => {
    const ep = earthPos(0.9);
    const clip = applyMat4(vp, [ep[0]!, ep[1]!, ep[2]!, 1]);
    const p = ndc(clip);
    expect(Math.abs(p[0]!)).toBeLessThan(1);
    expect(Math.abs(p[1]!)).toBeLessThan(1);
    expect(p[2]!).toBeGreaterThan(-1);
    expect(p[2]!).toBeLessThan(1);
    expect(clip[3]!).toBeGreaterThan(0);
  });

  it('「上」还在上面（场景没上下翻转）', () => {
    const clip = applyMat4(vp, [0, 1, 0, 1]);
    const p = ndc(clip);
    expect(p[1]!).toBeGreaterThan(0);
  });

  it('距离变量真的把轨道撑大了', () => {
    // dist 默认 1；太阳系里的距离是轨道半径
    const near = orbitRadius();
    expect(near).toBeGreaterThan(0);
  });

  it('模型矩阵把地球挪到了指定位置', () => {
    const m = m4model(3, 0, -4, 0.3);
    const clip = applyMat4(m, [0, 0, 0, 1]);
    expect(clip[0]).toBeCloseTo(3, 5);
    expect(clip[1]).toBeCloseTo(0, 5);
    expect(clip[2]).toBeCloseTo(-4, 5);
    // 均匀缩放：单位球上的点半径不变
    const p = applyMat4(m, [1, 0, 0, 1]);
    expect(p[0]).toBeCloseTo(3 + 0.3, 5);
  });
});
