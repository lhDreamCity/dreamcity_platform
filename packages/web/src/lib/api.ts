/**
 * 前端 API 客户端
 *
 * 三种身份各自存一份 token（讲师 / 家长 / 学员），互不干扰。
 */

export type Identity = 'staff' | 'guardian' | 'student';

const KEYS: Record<Identity, string> = {
  staff: 'dc.staff.token',
  guardian: 'dc.guardian.token',
  student: 'dc.student.token',
};

export function getToken(identity: Identity): string | null {
  try {
    return localStorage.getItem(KEYS[identity]);
  } catch {
    return null;
  }
}

export function setToken(identity: Identity, token: string | null): void {
  try {
    if (token) localStorage.setItem(KEYS[identity], token);
    else localStorage.removeItem(KEYS[identity]);
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  identity?: Identity;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, identity, signal } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (identity) {
    const token = getToken(identity);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const p = (payload ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, p.error ?? 'ERROR', p.message ?? '出了点小状况');
  }
  return payload as T;
}
