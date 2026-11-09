import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { TEACHER } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Empty, TopBar } from '../shared-ui';

const NAV = [
  { to: '/teacher/lessons', label: TEACHER.nav.lessons },
  { to: '/teacher/sessions', label: TEACHER.nav.sessions },
  { to: '/teacher/plugins', label: TEACHER.nav.plugins },
];

interface SessionRow {
  id: string;
  lessonId: string;
  lessonTitle: string;
  levelId: string;
  state: 'DRAFT' | 'LIVE' | 'CLOSED';
  classCode: string | null;
  participantCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

export function SessionList() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionRow[]>('/api/sessions', { identity: 'staff' }),
  });

  const open = useMutation({
    mutationFn: async (id: string) => {
      return api<{ classCode: string }>(`/api/sessions/${id}/open`, {
        method: 'POST',
        identity: 'staff',
      });
    },
    onSuccess: () => {
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const rows = sessions.data ?? [];

  return (
    <div>
      <TopBar nav={NAV} active="/teacher/sessions" />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <h1>{TEACHER.sessionsTitle}</h1>
          <p>{TEACHER.sessionsSubtitle}</p>
        </div>

        {rows.length === 0 ? (
          <Empty>还没有上过课。先去课次库排一节课。</Empty>
        ) : (
          <div className="card flat">
            <table className="table">
              <thead>
                <tr>
                  <th>课次</th>
                  <th>状态</th>
                  <th>人数</th>
                  <th>课堂码</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/teacher/sessions/${s.id}`} className="strong">
                        {s.lessonTitle}
                      </Link>
                      <div className="tiny muted">{s.lessonId}</div>
                    </td>
                    <td>
                      <span
                        className={
                          s.state === 'LIVE'
                            ? 'chip mint'
                            : s.state === 'CLOSED'
                              ? 'chip ghost'
                              : 'chip on'
                        }
                      >
                        {s.state === 'LIVE' ? '上课中' : s.state === 'CLOSED' ? '已结课' : '草稿'}
                      </span>
                    </td>
                    <td>{s.participantCount}</td>
                    <td>
                      {s.classCode ? (
                        <span className="chip" style={{ letterSpacing: '.15em' }}>
                          {s.classCode}
                        </span>
                      ) : (
                        <span className="tiny muted">—</span>
                      )}
                    </td>
                    <td className="tiny muted">
                      {s.startedAt ? new Date(s.startedAt).toLocaleString('zh-CN') : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn sm ghost" to={`/teacher/sessions/${s.id}`}>
                        {s.state === 'DRAFT' ? '去开课' : '回看'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openId ? (
          <div
            className="deep-bg"
            style={{
              position: 'fixed',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              zIndex: 50,
            }}
            onClick={() => setOpenId(null)}
          >
            <div className="card" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
              <div className="card-title">开课</div>
              <p className="card-desc">开课后生成 6 位课堂码，学生扫码即可进入。</p>
              <button className="btn" onClick={() => open.mutate(openId)} disabled={open.isPending}>
                生成课堂码
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
