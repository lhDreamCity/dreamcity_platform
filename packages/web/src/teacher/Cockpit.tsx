import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PHASES, TEACHER, type Phase } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Avatar, Empty, TopBar } from '../shared-ui';
import { ActivityHost } from './ActivityHost';

const NAV = [
  { to: '/teacher/lessons', label: TEACHER.nav.lessons },
  { to: '/teacher/sessions', label: TEACHER.nav.sessions },
  { to: '/teacher/plugins', label: TEACHER.nav.plugins },
];

interface CockpitState {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  state: 'DRAFT' | 'LIVE' | 'CLOSED';
  classCode: string | null;
  startedAt: string | null;
  elapsedMin: number;
  participantCount: number;
  phases: {
    phase: Phase;
    plannedMin: number;
    actualMin: number;
    actualSec: number;
    startedAt: string | null;
    endedAt: string | null;
    isCurrent: boolean;
  }[];
  activities: {
    id: string;
    seq: number;
    phase: Phase;
    modeCard: string | null;
    atom: string | null;
    title: string;
    durationMin: number;
    pluginId: string | null;
    resourceId: string | null;
    activityKind: string;
  }[];
  participants: {
    studentId: string;
    displayName: string;
    avatarKey: string;
    avatarStage: number;
    askedCount: number;
    joinedAt: string | null;
  }[];
  currentActivityId: string | null;
  offlineFallback: string | null;
}

interface LaunchResult {
  activityId: string;
  entry: string | null;
  activityKind: string;
  resourceId: string | null;
}

interface StudentRow {
  id: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  grade: number;
  guardianName: string;
  phoneTail: string;
  state: string;
}

export function Cockpit() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [currentActivity, setCurrentActivity] = useState<LaunchResult | null>(null);
  const [tick, setTick] = useState(0);
  const [picking, setPicking] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');

  const cockpit = useQuery({
    queryKey: ['cockpit', id],
    queryFn: () => api<CockpitState>(`/api/sessions/${id}/cockpit`, { identity: 'staff' }),
    refetchInterval: 10_000,
  });

  /** 学员名册：用来点名 */
  const directory = useQuery({
    queryKey: ['students'],
    queryFn: () => api<StudentRow[]>('/api/students', { identity: 'staff' }),
    enabled: picking,
  }).data ?? [];

  const addStudent = useMutation({
    mutationFn: async (studentId: string) => {
      return api(`/api/sessions/${id}/participants`, {
        method: 'POST',
        identity: 'staff',
        body: { studentId },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cockpit', id] }),
  });

  const removeStudent = useMutation({
    mutationFn: async (studentId: string) => {
      return api(`/api/sessions/${id}/participants/${studentId}`, {
        method: 'DELETE',
        identity: 'staff',
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cockpit', id] }),
  });

  // 本地秒级心跳：让「进行中」环节的计时看起来是活的
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const state = cockpit.data;

  const phaseOp = useMutation({
    mutationFn: async (phase: Phase) => {
      const current = state?.phases.find((p) => p.isCurrent);
      if (current && current.phase !== phase) {
        await api(`/api/sessions/${id}/phases/${encodeURIComponent(current.phase)}/end`, {
          method: 'POST',
          identity: 'staff',
        });
      }
      if (!current || current.phase !== phase) {
        await api(`/api/sessions/${id}/phases/${encodeURIComponent(phase)}/start`, {
          method: 'POST',
          identity: 'staff',
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cockpit', id] }),
  });

  const capture = useMutation({
    mutationFn: async (payload: { studentId: string; kind: '完成' | '卡住' | '已单独问过' }) => {
      await api(`/api/sessions/${id}/captures`, {
        method: 'POST',
        identity: 'staff',
        body: payload,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cockpit', id] }),
  });

  const launch = useMutation({
    mutationFn: async (activityId: string) => {
      const res = await api<LaunchResult>(`/api/sessions/${id}/activities/${activityId}/launch`, {
        method: 'POST',
        identity: 'staff',
      });
      return res;
    },
    onSuccess: (res) => {
      setCurrentActivity(res);
      qc.invalidateQueries({ queryKey: ['cockpit', id] });
    },
  });

  const closeClass = useMutation({
    mutationFn: async () => {
      return api<{ draft: string; artifactCount: number }>(`/api/sessions/${id}/close`, {
        method: 'POST',
        identity: 'staff',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      navigate('/teacher/sessions');
    },
  });

  const openClass = useMutation({
    mutationFn: async () => {
      return api<{ classCode: string }>(`/api/sessions/${id}/open`, {
        method: 'POST',
        identity: 'staff',
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cockpit', id] }),
  });

  const elapsed = useMemo(() => {
    if (!state?.startedAt) return 0;
    return Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000);
  }, [state?.startedAt, tick]);

  const nextPhase = useMemo(() => {
    const idx = state?.phases.findIndex((p) => p.isCurrent) ?? -1;
    if (idx < 0) return state?.phases[0] ?? null;
    return state?.phases[idx + 1] ?? null;
  }, [state]);

  const currentPhase = state?.phases.find((p) => p.isCurrent) ?? null;

  const showCountdown = useRef<number | null>(null);
  useEffect(() => () => {
    if (showCountdown.current) window.clearInterval(showCountdown.current);
  }, []);

  if (!state) {
    return (
      <div>
        <TopBar nav={NAV} active="/teacher/sessions" />
        <div className="wrap">
          <Empty>正在加载驾驶舱…</Empty>
        </div>
      </div>
    );
  }

  const isLive = state.state === 'LIVE';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--paper)' }}>
      {/* ── 顶栏 ─────────────────────────────────────── */}
      <div className="topbar" style={{ position: 'static' }}>
        <div className="topbar-inner">
          <span className="brand">
            {state.lessonTitle}
            <small>
              {state.lessonId} · {state.participantCount} 人 · 剩余 {fmt(elapsed)}
            </small>
          </span>
          <nav className="topnav">
            <span className="chip" style={{ background: isLive ? 'var(--mint)' : 'var(--deep-btn)', color: isLive ? 'var(--deep)' : 'var(--deep-text)' }}>
              {isLive ? '上课中' : state.state === 'CLOSED' ? '已结课' : '未开课'}
            </span>
            {state.classCode ? (
              <span className="chip" style={{ background: 'var(--star)', color: '#5a4400', letterSpacing: '.18em' }}>
                课堂码 {state.classCode}
              </span>
            ) : null}
          </nav>
          <div className="spacer" />
          {!isLive && state.state !== 'CLOSED' ? (
            <button className="btn sm" onClick={() => openClass.mutate()} disabled={openClass.isPending}>
              {TEACHER.openClass}
            </button>
          ) : null}
          {isLive ? (
            <button className="btn sm deep" onClick={() => closeClass.mutate()} disabled={closeClass.isPending}>
              {TEACHER.closeClass}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── 一屏三区 ─────────────────────────────────── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 12, padding: 12, minHeight: 0 }}>
        {/* 左 · 90 分钟时间轴 */}
        <div className="card flat" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">{TEACHER.timeline}</div>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {state.phases.map((p) => {
              const over = p.actualMin > p.plannedMin;
              return (
                <button
                  key={p.phase}
                  onClick={() => phaseOp.mutate(p.phase)}
                  className="card flat"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderLeft: `3px solid ${p.isCurrent ? 'var(--accent)' : 'var(--line)'}`,
                    background: p.isCurrent ? 'var(--paper-2)' : 'var(--white)',
                  }}
                >
                  <div className="row tight">
                    <span className="strong small">{p.phase}</span>
                    <span className="tiny muted">计划 {p.plannedMin}′</span>
                    <div className="spacer" />
                    {p.isCurrent ? <span className="chip on tiny">{TEACHER.current}</span> : null}
                  </div>
                  <div className="tiny" style={{ color: over ? 'var(--l3-2)' : 'var(--muted)', marginTop: 3 }}>
                    实耗 {p.isCurrent ? fmt(p.actualSec) : `${p.actualMin}′`}
                    {over ? '（超了）' : ''}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="notice" style={{ marginTop: 12 }}>
            实耗是自动算的，你不用记。
          </div>
        </div>

        {/* 中 · 投屏 / 控制 */}
        <div className="card flat" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0, overflow: 'hidden' }}>
          <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <span className="strong small">{TEACHER.projector}</span>
            {currentPhase ? <span className="chip on tiny">{currentPhase.phase}</span> : null}
            <div className="spacer" />
            {nextPhase ? (
              <span className="tiny muted">
                {TEACHER.nextUp}：{nextPhase.phase} {nextPhase.plannedMin}′
              </span>
            ) : null}
          </div>

          <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--deep)' }}>
            {currentActivity ? (
              <ActivityHost
                sessionId={state.sessionId}
                activityId={currentActivity.activityId}
                entry={currentActivity.entry}
                studentId={null}
                studentNickname={null}
                level={null}
                onResult={() => qc.invalidateQueries({ queryKey: ['cockpit', id] })}
              />
            ) : (
              <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--deep-sub)' }}>
                <div className="center">
                  <div style={{ fontSize: 15, marginBottom: 6 }}>选一个活动拉起</div>
                  <div className="tiny muted">点下面的环节开始这节课</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--line)', padding: 10, maxHeight: 220, overflowY: 'auto' }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="tiny strong">活动序列</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {state.activities.map((a) => (
                <div key={a.id} className="row tight" style={{ padding: '6px 8px', borderRadius: 8, background: currentActivity?.activityId === a.id ? 'var(--paper-2)' : 'transparent' }}>
                  <span className="badge-num c2" style={{ width: 20, height: 20, fontSize: 11 }}>
                    {a.seq}
                  </span>
                  <span className="tiny" style={{ width: 34, color: 'var(--muted)' }}>
                    {a.phase}
                  </span>
                  <span className="small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title}
                  </span>
                  <span className="tiny muted">{a.durationMin}′</span>
                  <button className="btn sm ghost" onClick={() => launch.mutate(a.id)}>
                    {TEACHER.launchActivity}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {state.offlineFallback ? (
            <div className="notice" style={{ margin: 10, borderRadius: 10 }}>
              {TEACHER.offlineFallback}：{state.offlineFallback}
            </div>
          ) : null}
        </div>

        {/* 右 · 名单与采集 */}
        <div className="card flat" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>{TEACHER.roster}</span>
            <div className="spacer" />
            <button className="btn sm ghost" onClick={() => setPicking((v) => !v)}>
              + {TEACHER.addStudent}
            </button>
          </div>

          {picking ? (
            <div className="card flat" style={{ marginBottom: 10, padding: '10px 12px' }}>
              <div className="tiny strong" style={{ marginBottom: 8 }}>
                {TEACHER.pickStudent}
              </div>
              <input
                className="input"
                style={{ padding: '5px 8px', fontSize: 13, marginBottom: 8 }}
                placeholder={TEACHER.searchStudents}
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
              />
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {directory.filter((s) => s.state === 'ACTIVE').length === 0 ? (
                  <p className="tiny muted">{TEACHER.studentsEmpty}</p>
                ) : (
                  directory
                    .filter((s) => s.state === 'ACTIVE')
                    .filter((s) =>
                      studentQuery
                        ? `${s.displayName}${s.guardianName}${s.phoneTail}`.includes(studentQuery)
                        : true,
                    )
                    .map((s) => {
                      const already = state.participants.some((p) => p.studentId === s.id);
                      return (
                        <button
                          key={s.id}
                          className="row tight"
                          style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: 8,
                            padding: '6px 4px',
                            cursor: already ? 'default' : 'pointer',
                            opacity: already ? 0.45 : 1,
                            textAlign: 'left',
                          }}
                          disabled={already || addStudent.isPending}
                          onClick={() => addStudent.mutate(s.id)}
                        >
                          <Avatar avatarKey={s.avatarKey} stage={s.avatarStage} size={26} />
                          <span className="small">{s.displayName}</span>
                          <span className="tiny muted">
                            {s.grade}年级 · {s.guardianName}
                          </span>
                          <div className="spacer" />
                          {already ? <span className="tiny muted">已在班</span> : null}
                        </button>
                      );
                    })
                )}
              </div>
            </div>
          ) : null}

          <div className="stack" style={{ gap: 8 }}>
            {state.participants.length === 0 ? (
              <p className="tiny muted">{TEACHER.addStudentHint}</p>
            ) : (
              state.participants.map((p) => (
                <div key={p.studentId} className="card flat" style={{ padding: '9px 11px' }}>
                  <div className="row tight">
                    <Avatar avatarKey={p.avatarKey} stage={p.avatarStage} size={26} />
                    <span className="strong small">{p.displayName}</span>
                    <div className="spacer" />
                    {p.askedCount > 0 ? (
                      <span className="chip mint tiny">{TEACHER.askedAlready} ×{p.askedCount}</span>
                    ) : (
                      <span className="chip warm tiny">{TEACHER.notAskedYet}</span>
                    )}
                    <button
                      className="btn sm ghost"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      title={TEACHER.removeStudent}
                      onClick={() => removeStudent.mutate(p.studentId)}
                      disabled={removeStudent.isPending}
                    >
                      ×
                    </button>
                  </div>
                  <div className="row tight" style={{ marginTop: 7 }}>
                    {(['完成', '卡住', '已单独问过'] as const).map((kind) => (
                      <button
                        key={kind}
                        className={`btn sm ${kind === '卡住' ? 'ghost' : kind === '已单独问过' ? 'deep' : 'mint'}`}
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => capture.mutate({ studentId: p.studentId, kind })}
                        disabled={capture.isPending}
                      >
                        {kind === '完成'
                          ? TEACHER.captureDone
                          : kind === '卡住'
                            ? TEACHER.captureStuck
                            : TEACHER.captureAsked}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="notice" style={{ marginTop: 12 }}>
            {TEACHER.captureHint}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
