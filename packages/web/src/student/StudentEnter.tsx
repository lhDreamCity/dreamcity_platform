import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STUDENT } from '@dreamcity/shared';
import { api, setToken } from '../lib/api';
import { Avatar, Mascot } from '../shared-ui';

interface EnterResponse {
  sessionId: string;
  rosterPending?: boolean;
  students: {
    studentId: string;
    displayName: string;
    avatarKey: string;
    avatarStage: number;
  }[];
}

/**
 * 学生进入：课堂码 → 点一下头像
 *
 * 没有密码框，没有手机号。8 岁孩子不需要记任何东西。
 */
export function StudentEnter() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [roster, setRoster] = useState<EnterResponse['students'] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<EnterResponse>('/api/auth/student/enter', {
        method: 'POST',
        body: { classCode: code },
      });
      setRoster(res.students);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(studentId: string) {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('/api/auth/student/pick', {
        method: 'POST',
        body: { classCode: code, studentId },
      });
      setToken('student', res.token);
      navigate('/student/session');
    } catch (err) {
      // 没被排进这节课 ≠ 课堂码错了，给出能行动的下一步
      setError((err as Error).message || STUDENT.notOnListHint);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deep-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 460, textAlign: 'center' }}>
        <Mascot level="GRADE_L1" size="lg" />
        <h1 style={{ fontSize: 26, marginTop: 14 }}>
          {roster ? STUDENT.pickTitle : STUDENT.enterTitle}
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>
          {roster ? STUDENT.pickSubtitle : STUDENT.enterSubtitle}
        </p>

        {!roster ? (
          <form onSubmit={enter} style={{ marginTop: 24 }}>
            <input
              className="input"
              style={{
                fontSize: 28,
                letterSpacing: '.35em',
                textAlign: 'center',
                padding: '14px 10px',
                background: 'var(--white)',
              }}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
            />
            {error ? (
              <div className="notice" style={{ marginTop: 14 }}>
                {error}
              </div>
            ) : null}
            <button className="btn lg block" type="submit" disabled={busy || code.length !== 6} style={{ marginTop: 16 }}>
              {STUDENT.enter}
            </button>
          </form>
        ) : roster.length === 0 ? (
          /* 老师还在点名 —— 不是孩子的错 */
          <div className="card" style={{ marginTop: 26, textAlign: 'left' }}>
            <div className="strong">{STUDENT.rosterEmptyTitle}</div>
            <p className="card-desc" style={{ marginTop: 6 }}>
              {STUDENT.rosterEmptyHint}
            </p>
            <button
              className="btn ghost sm"
              style={{ marginTop: 14 }}
              onClick={() => {
                setRoster(null);
                setError('');
              }}
            >
              重新输入课堂码
            </button>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 26, justifyContent: 'center' }}>
            {roster.map((s) => (
              <button
                key={s.studentId}
                className="card flat"
                onClick={() => pick(s.studentId)}
                disabled={busy}
                style={{ cursor: 'pointer', textAlign: 'center', padding: '16px 20px', width: 140 }}
              >
                <Avatar avatarKey={s.avatarKey} stage={s.avatarStage} size={64} title={s.displayName} />
                <div className="strong" style={{ marginTop: 8 }}>
                  {s.displayName}
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {STUDENT.confirmIdentity}
                </div>
              </button>
            ))}
          </div>
        )}

        {roster && roster.length > 0 && error ? (
          <div className="notice" style={{ marginTop: 14 }}>
            <div className="strong">{STUDENT.notOnListTitle}</div>
            <div style={{ marginTop: 4 }}>{error}</div>
            <div style={{ marginTop: 6 }}>{STUDENT.notOnListAskTeacher}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
