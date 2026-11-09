import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TEACHER } from '@dreamcity/shared';
import { api, isTokenLive, setToken } from '../lib/api';

/**
 * 后台登录
 *
 * 页面在隐藏 URL（/console）上，落地页没有入口 —— 这是第一道闸。
 * 账号 + 密码是第二道闸，由服务端校验，前端不做任何判断。
 */
export function TeacherLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 已经登进去了就别停在登录页
  useEffect(() => {
    if (isTokenLive('staff')) navigate('/console/lessons', { replace: true });
  }, [navigate]);

  /**
   * 只有服务端说「现在还在用开发默认口令」时才显示账号提示。
   * 换了口令之后，这个提示就自己消失了 —— 免得口令一直躺在页面上。
   */
  const config = useQuery({
    queryKey: ['staff-config'],
    queryFn: () => api<{ defaultCredentialsInUse: boolean }>('/api/auth/staff/config'),
    retry: false,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('/api/auth/staff/login', {
        method: 'POST',
        body: { username, password },
      });
      setToken('staff', res.token);
      navigate('/console/lessons');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deep-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 400 }}>
        <div className="center" style={{ marginBottom: 22 }}>
          <span className="chip">{TEACHER.loginSubtitle}</span>
          <h1 style={{ fontSize: 24, marginTop: 12 }}>{TEACHER.loginTitle}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>梦之城 · 课堂操作系统</p>
        </div>

        <form
          className="card"
          onSubmit={submit}
          style={{ background: 'var(--white)', display: 'grid', gap: 4 }}
        >
          <div className="field">
            <label htmlFor="username">{TEACHER.usernamePlaceholder}</label>
            <input
              id="username"
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">{TEACHER.passwordPlaceholder}</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <div className="notice" style={{ marginBottom: 12 }}>
              {error}
            </div>
          ) : null}
          <button className="btn block" type="submit" disabled={busy}>
            {busy ? '…' : TEACHER.login}
          </button>
        </form>

        {config.data?.defaultCredentialsInUse ? (
          <p className="center" style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)' }}>
            开发占位账号：admin / 123456
          </p>
        ) : null}
      </div>
    </div>
  );
}
