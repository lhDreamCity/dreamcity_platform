import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SHOWCASE, STUDENT } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Empty, Mascot, ScopeChip } from '../shared-ui';

interface StudentSessionResponse {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  student: {
    id: string;
    displayName: string;
    avatarKey: string;
    avatarStage: number;
  } | null;
  activities: {
    id: string;
    seq: number;
    phase: string;
    title: string;
    durationMin: number;
    activityKind: string;
    entry: string | null;
  }[];
}

interface WallItem {
  id: string;
  title: string;
  visibility: string;
  content: Record<string, unknown>;
  displayName: string;
  avatarKey: string;
  isMine: boolean;
  notes: { id: string; noteType: string; content: string; fromName: string }[];
}

const NOTE_TYPES = ['注意到', '喜欢', '想问'] as const;

export function StudentSession() {
  const qc = useQueryClient();
  const [noteFor, setNoteFor] = useState<WallItem | null>(null);
  const [noteType, setNoteType] = useState<(typeof NOTE_TYPES)[number]>('注意到');
  const [noteText, setNoteText] = useState('');
  const [sent, setSent] = useState(false);

  const session = useQuery({
    queryKey: ['student-session'],
    queryFn: () => api<StudentSessionResponse>('/api/student/session', { identity: 'student' }),
  });

  const wall = useQuery({
    queryKey: ['student-wall'],
    queryFn: () => api<{ items: WallItem[] }>('/api/student/wall', { identity: 'student' }),
  });

  const leaveNote = useMutation({
    mutationFn: async (payload: { showcaseId: string; noteType: string; content: string }) => {
      return api('/api/student/notes', {
        method: 'POST',
        identity: 'student',
        body: payload,
      });
    },
    onSuccess: () => {
      setSent(true);
      setNoteText('');
      qc.invalidateQueries({ queryKey: ['student-wall'] });
      setTimeout(() => {
        setSent(false);
        setNoteFor(null);
      }, 1400);
    },
  });

  if (session.isError) {
    return (
      <div className="deep-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="center">
          <Empty>{STUDENT.noWorkYet}</Empty>
          <Link className="btn" to="/student/enter" style={{ marginTop: 16 }}>
            重新输入课堂码
          </Link>
        </div>
      </div>
    );
  }

  const data = session.data;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <Mascot level="GRADE_L1" size="sm" />
            <span>
              {data?.lessonTitle ?? '今天的课'}
              <small>{data?.student?.displayName ?? ''}</small>
            </span>
          </span>
          <nav className="topnav">
            <Link to="/student/showcase">{STUDENT.showcaseTitle}</Link>
            <Link to="/student/enter">换人</Link>
          </nav>
        </div>
      </header>

      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <h1>{STUDENT.sessionTitle}</h1>
          <p>{STUDENT.activitiesTitle}</p>
        </div>

        <div className="grid3">
          {(data?.activities ?? []).map((a) => (
            <div key={a.id} className="card">
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="badge-num c1">{a.seq}</span>
                <span className="chip ghost">{a.phase}</span>
                <div className="spacer" />
                <span className="tiny muted">{a.durationMin}′</span>
              </div>
              <div className="strong" style={{ marginBottom: 10 }}>
                {a.title}
              </div>
              {a.entry ? (
                <a className="btn sm" href={`/activities/${a.entry}`} target="_blank" rel="noreferrer">
                  {STUDENT.launch}
                </a>
              ) : (
                <span className="tiny muted">跟着老师一起做就好</span>
              )}
            </div>
          ))}
        </div>

        {/* 本班作品墙 */}
        <div className="page-head" style={{ paddingTop: 32 }}>
          <h1>{SHOWCASE.wallTitle}</h1>
          <p>{SHOWCASE.wallSubtitle}</p>
        </div>

        {!wall.data?.items.length ? (
          <Empty>{SHOWCASE.emptyWall}</Empty>
        ) : (
          <div className="grid3">
            {wall.data.items.map((item) => (
              <div key={item.id} className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="strong small">{item.displayName}</span>
                  <div className="spacer" />
                  <ScopeChip scope={item.visibility} />
                </div>
                <div className="small" style={{ color: 'var(--body)', marginBottom: 10 }}>
                  {item.title}
                </div>

                {item.notes.length ? (
                  <div className="stack" style={{ gap: 6, marginBottom: 10 }}>
                    {item.notes.map((n) => (
                      <div
                        key={n.id}
                        className="tiny"
                        style={{
                          background: 'var(--paper)',
                          borderRadius: 8,
                          padding: '7px 10px',
                          color: 'var(--body)',
                        }}
                      >
                        <b>{n.fromName}</b> · {n.content}
                      </div>
                    ))}
                  </div>
                ) : null}

                {!item.isMine ? (
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setNoteFor(item);
                      setNoteType('注意到');
                      setNoteText('');
                    }}
                  >
                    {SHOWCASE.leaveNote}
                  </button>
                ) : (
                  <span className="chip ghost tiny">这是你的</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 留言弹窗：只有三类句式 */}
      {noteFor ? (
        <div
          className="deep-bg"
          style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 50 }}
          onClick={() => setNoteFor(null)}
        >
          <div
            className="card"
            style={{ width: 'min(520px, 92vw)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-title">{STUDENT.notesTitle}</div>
            <p className="card-desc">{STUDENT.notesHint}</p>

            <div className="chip-row" style={{ margin: '12px 0' }}>
              {NOTE_TYPES.map((t) => (
                <button
                  key={t}
                  className={noteType === t ? 'chip on' : 'chip ghost'}
                  onClick={() => {
                    setNoteType(t);
                    setNoteText(`我${t}`);
                  }}
                >
                  我{t}…
                </button>
              ))}
            </div>

            <textarea
              className="input"
              style={{ minHeight: 90, padding: 12, resize: 'vertical', width: '100%' }}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={STUDENT.notePlaceholder}
            />

            {sent ? (
              <div className="notice" style={{ marginTop: 12 }}>
                {STUDENT.noteSent}
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setNoteFor(null)}>
                取消
              </button>
              <button
                className="btn"
                disabled={leaveNote.isPending || !noteText.startsWith(`我${noteType}`)}
                onClick={() =>
                  leaveNote.mutate({
                    showcaseId: noteFor.id,
                    noteType,
                    content: noteText,
                  })
                }
              >
                {STUDENT.noteSend}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
