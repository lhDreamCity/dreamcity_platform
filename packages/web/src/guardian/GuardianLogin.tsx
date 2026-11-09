import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GUARDIAN } from '@dreamcity/shared';
import { api, setToken } from '../lib/api';

export function GuardianLogin() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/guardian/send-code', { method: 'POST', body: { phone } });
      setSent(true);
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((n) => {
          if (n <= 1) {
            clearInterval(timer);
            return 0;
          }
          return n - 1;
        });
      }, 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('/api/auth/guardian/login', {
        method: 'POST',
        body: { phone, code },
      });
      setToken('guardian', res.token);
      navigate('/guardian');
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
          <span className="chip">梦之城 AI 赋能中心</span>
          <h1 style={{ fontSize: 24, marginTop: 12 }}>{GUARDIAN.loginTitle}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>{GUARDIAN.loginSubtitle}</p>
        </div>

        <form className="card" onSubmit={submit} style={{ background: 'var(--white)' }}>
          <div className="field">
            <label htmlFor="phone">{GUARDIAN.phonePlaceholder}</label>
            <input
              id="phone"
              className="input"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11 位手机号"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="code">{GUARDIAN.codePlaceholder}</label>
            <div className="row tight">
              <input
                id="code"
                className="input"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn ghost"
                onClick={sendCode}
                disabled={busy || countdown > 0}
                style={{ whiteSpace: 'nowrap' }}
              >
                {countdown > 0 ? `${countdown}${GUARDIAN.resendIn}` : GUARDIAN.sendCode}
              </button>
            </div>
          </div>
          {error ? (
            <div className="notice" style={{ marginBottom: 12 }}>
              {error}
            </div>
          ) : null}
          {sent && !error ? (
            <div className="notice" style={{ marginBottom: 12 }}>
              验证码已经发出（开发模式会打到服务端控制台，验证码是 00000）
            </div>
          ) : null}
          <button className="btn block" type="submit" disabled={busy}>
            {GUARDIAN.login}
          </button>
        </form>
      </div>
    </div>
  );
}
