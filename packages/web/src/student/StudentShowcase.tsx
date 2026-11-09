import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SHOWCASE, STUDENT } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Empty, Mascot, ScopeChip } from '../shared-ui';

interface ShowcaseItem {
  id: string;
  title: string;
  visibility: string;
  createdAt: string;
  content: Record<string, unknown>;
  type: string | null;
  notes: { id: string; noteType: string; content: string; fromName: string; createdAt: string }[];
  viewedBy: { name: string; relation: string }[];
}

interface ShowcaseResponse {
  student: {
    id: string;
    displayName: string;
    avatarKey: string;
    avatarStage: number;
    levelId: string | null;
    levelName: string | null;
    badge: string[];
  } | null;
  items: ShowcaseItem[];
  visibleScopes: string[];
}

/**
 * 我的展位
 *
 * 人人有份，按时间排序，不按优劣。
 * 能看到「谁看过、谁留了什么话」，但不显示任何数字（C8）。
 */
export function StudentShowcase() {
  const { data, isLoading } = useQuery({
    queryKey: ['student-showcase'],
    queryFn: () => api<ShowcaseResponse>('/api/student/showcase', { identity: 'student' }),
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <Mascot level={data?.student?.levelId ?? 'GRADE_L1'} size="sm" />
            <span>
              {STUDENT.showcaseTitle}
              <small>{data?.student?.displayName ?? ''}</small>
            </span>
          </span>
          <nav className="topnav">
            <Link to="/student/session">回到课</Link>
            <Link to="/student/enter">换人</Link>
          </nav>
        </div>
      </header>

      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="card" style={{ marginTop: 20, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <Mascot level={data?.student?.levelId ?? 'GRADE_L1'} size="lg" />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row">
              <span style={{ fontSize: 22, fontWeight: 800 }}>{data?.student?.displayName}</span>
              {data?.student?.levelName ? <span className="chip">{data.student.levelName}</span> : null}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              {STUDENT.showcaseSubtitle}
            </p>
            {data?.student?.badge?.length ? (
              <div className="chip-row" style={{ marginTop: 10 }}>
                {data.student.badge.map((b) => (
                  <span key={b} className="chip star">
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="page-head" style={{ paddingTop: 28 }}>
          <h1>{SHOWCASE.itemTitle}</h1>
          <p>按时间排，不分好坏。</p>
        </div>

        {isLoading ? (
          <Empty>正在加载…</Empty>
        ) : !data?.items.length ? (
          <Empty>{STUDENT.noWorkYet}</Empty>
        ) : (
          <div className="grid3">
            {data.items.map((item) => (
              <div key={item.id} className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="chip ghost">{item.type ?? '作品'}</span>
                  <div className="spacer" />
                  <ScopeChip scope={item.visibility} />
                </div>
                <div className="strong" style={{ marginBottom: 8 }}>
                  {item.title}
                </div>
                <div className="tiny muted" style={{ marginBottom: 10 }}>
                  {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                </div>

                {item.notes.length ? (
                  <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
                    <div className="tiny strong">{SHOWCASE.noteSent}</div>
                    {item.notes.map((n) => (
                      <div
                        key={n.id}
                        className="tiny"
                        style={{
                          background: 'var(--paper)',
                          borderRadius: 8,
                          padding: '8px 10px',
                          color: 'var(--body)',
                        }}
                      >
                        <b>{n.fromName}</b> · {n.content}
                      </div>
                    ))}
                  </div>
                ) : null}

                {item.viewedBy.length ? (
                  <div className="tiny muted">
                    {STUDENT.viewedBy}：
                    {item.viewedBy.map((v) => `${v.name}（${v.relation}）`).join('、')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 28 }}>
          <Link className="btn" to="/student/session">
            回到今天的课
          </Link>
        </div>
      </div>
    </div>
  );
}
