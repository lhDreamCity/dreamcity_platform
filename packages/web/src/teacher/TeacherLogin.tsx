import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEACHER } from '@dreamcity/shared';
import { api, setToken } from '../lib/api';

export function TeacherLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('/api/auth/staff/login', {
        method: 'POST',
        body: { email, password },
      });
      setToken('staff', res.token);
      navigate('/teacher/lessons');
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
            <label htmlFor="email">{TEACHER.emailPlaceholder}</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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

        <p className="center" style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)' }}>
          演示账号：teacher@dreamcity.cn / dreamcity-demo
        </p>
      </div>
    </div>
  );
}
