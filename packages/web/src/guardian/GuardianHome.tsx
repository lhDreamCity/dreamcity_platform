import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { GUARDIAN } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Avatar, Empty, LevelChip, Mascot, ScopeChip, TopBar } from '../shared-ui';
import { AddChild } from './AddChild';

interface Child {
  id: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  grade: number;
  levelId: string | null;
  state: string;
  levelName: string | null;
  consents?: {
    wall: boolean;
    media: boolean;
    data: boolean;
    crossTerm: boolean;
  };
}

interface TimelineItem {
  id: string;
  lessonId: string | null;
  lessonTitle: string | null;
  type: string;
  title: string;
  content: Record<string, unknown>;
  visibility: string;
  createdAt: string;
  teacherComment: string | null;
}

interface TimelineResponse {
  items: TimelineItem[];
  feedback: {
    id: string;
    content: string;
    teacherComment: string | null;
    nextStep: string | null;
    sentAt: string | null;
  }[];
  remainingLessons: number | null;
  totalLessons: number | null;
}

interface ProfileResponse {
  studentId: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  levelId: string | null;
  levelName: string | null;
  grade: number;
  badge: string[];
  completedLessons: number;
  totalLessons: number | null;
  remainingLessons: number | null;
  artifacts: number;
}

interface NoteItem {
  id: string;
  noteType: string;
  content: string;
  createdAt: string;
  fromName: string;
  showcaseTitle: string;
}

const NAV = [
  { to: '/guardian', label: '孩子的课堂' },
  { to: '/guardian/settings', label: '可见范围与授权' },
];

export function GuardianHome() {
  const { id } = useParams();
  const [childId, setChildId] = useState<string | null>(id ?? null);
  const [adding, setAdding] = useState(false);

  const children = useQuery({
    queryKey: ['guardian-children'],
    queryFn: () => api<Child[]>('/api/guardian/children', { identity: 'guardian' }),
  });

  const current = childId ?? children.data?.[0]?.id ?? null;

  const timeline = useQuery({
    queryKey: ['guardian-timeline', current],
    queryFn: () => api<TimelineResponse>(`/api/guardian/children/${current}/timeline`, { identity: 'guardian' }),
    enabled: !!current,
  });

  const profile = useQuery({
    queryKey: ['guardian-profile', current],
    queryFn: () => api<ProfileResponse>(`/api/guardian/children/${current}/profile`, { identity: 'guardian' }),
    enabled: !!current,
  });

  const notes = useQuery({
    queryKey: ['guardian-notes', current],
    queryFn: () => api<NoteItem[]>(`/api/guardian/children/${current}/notes`, { identity: 'guardian' }),
    enabled: !!current,
  });

  if (children.isLoading) {
    return (
      <div>
        <TopBar nav={NAV} active="/guardian" />
        <div className="wrap">
          <Empty>正在加载…</Empty>
        </div>
      </div>
    );
  }

  if (!children.data?.length) {
    return (
      <div>
        <TopBar nav={NAV} active="/guardian" />
        <div className="wrap" style={{ paddingTop: 40, paddingBottom: 60 }}>
          <div className="page-head">
            <h1>{GUARDIAN.noChildrenTitle}</h1>
            <p>{GUARDIAN.noChildrenHint}</p>
          </div>
          <AddChild />
        </div>
      </div>
    );
  }

  const child = children.data.find((c) => c.id === current) ?? children.data[0]!;

  return (
    <div data-level={child.levelId ?? 'GRADE_L1'}>
      <TopBar
        nav={NAV}
        active="/guardian"
        level={child.levelId ?? 'GRADE_L1'}
        right={
          <Link className="btn sm ghost" to="/">
            退出
          </Link>
        }
      />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        {/* 孩子切换 */}
        <div className="row" style={{ marginTop: 18 }}>
          {children.data.map((c) => (
            <button
              key={c.id}
              className={c.id === child.id ? 'chip on' : 'chip ghost'}
              onClick={() => setChildId(c.id)}
            >
              {c.displayName}
            </button>
          ))}
          <button className="chip ghost" onClick={() => setAdding((v) => !v)}>
            + {GUARDIAN.addChildTitle}
          </button>
        </div>

        {adding ? (
          <div style={{ marginTop: 16 }}>
            <AddChild onDone={() => setAdding(false)} />
          </div>
        ) : null}

        {/* 头部：孩子是谁 + 成长档案摘要 */}
        <div className="card" style={{ marginTop: 18, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <Avatar avatarKey={child.avatarKey} stage={child.avatarStage} size={72} title={child.displayName} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row">
              <span style={{ fontSize: 22, fontWeight: 800 }}>{child.displayName}</span>
              <LevelChip levelId={child.levelId} />
              <span className="chip ghost">{child.grade} 年级</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="chip on">已上 {profile.data?.completedLessons ?? 0} 节</span>
              <span className="chip">剩余课时 {profile.data?.remainingLessons ?? '—'}</span>
              <span className="chip ghost">作品 {profile.data?.artifacts ?? 0} 件</span>
            </div>
            {profile.data?.badge?.length ? (
              <div className="chip-row" style={{ marginTop: 10 }}>
                {profile.data.badge.map((b) => (
                  <span key={b} className="chip star">
                    {b}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <Link className="btn sm ghost" to={`/guardian/children/${child.id}/grants`}>
              {GUARDIAN.grantsTitle}
            </Link>
            <a
              className="btn sm ghost"
              href={`/api/guardian/children/${child.id}/export`}
              onClick={(e) => {
                e.preventDefault();
                void exportData(child.id);
              }}
            >
              {GUARDIAN.export}
            </a>
          </div>
        </div>

        {/* 监护人知情同意状态 */}
        {child.consents ? (
          <div className="card flat" style={{ marginTop: 12 }}>
            <div className="row">
              <span className="strong small">{GUARDIAN.addChildConsentTitle}</span>
              <div className="spacer" />
              <Link className="tiny" to={`/guardian/children/${child.id}/grants`} style={{ color: 'var(--accent)' }}>
                去调整 →
              </Link>
            </div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              <span className={child.consents.data ? 'chip on' : 'chip ghost'}>
                {GUARDIAN.consentData}
              </span>
              <span className={child.consents.wall ? 'chip on' : 'chip ghost'}>
                {GUARDIAN.consentWall}
              </span>
              <span className={child.consents.media ? 'chip on' : 'chip ghost'}>
                {GUARDIAN.consentMedia}
              </span>
              <span className={child.consents.crossTerm ? 'chip on' : 'chip ghost'}>
                {GUARDIAN.consentCrossTerm}
              </span>
            </div>
          </div>
        ) : null}

        {/* 作品墙时间线 */}
        <div className="page-head" style={{ paddingTop: 28 }}>
          <h1>{GUARDIAN.timelineTitle}</h1>
          <p>{GUARDIAN.timelineSubtitle}</p>
        </div>

        {!timeline.data?.items.length ? (
          <Empty>{GUARDIAN.timelineSubtitle}</Empty>
        ) : (
          <div className="stack">
            {timeline.data.items.map((item) => (
              <div key={item.id} className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="chip on">{item.lessonTitle ?? '课堂产出'}</span>
                  <span className="chip ghost">{item.type}</span>
                  <ScopeChip scope={item.visibility} />
                  <div className="spacer" />
                  <span className="tiny muted">
                    {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <div className="strong" style={{ marginBottom: 6 }}>
                  {item.title}
                </div>
                <div className="small" style={{ color: 'var(--body)' }}>
                  {describeContent(item.content)}
                </div>
                {item.teacherComment ? (
                  <div
                    className="notice"
                    style={{ marginTop: 12, background: 'var(--paper-2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                  >
                    <b>{GUARDIAN.teacherComment}</b>
                    <br />
                    {item.teacherComment}
                  </div>
                ) : (
                  <div className="tiny muted" style={{ marginTop: 10 }}>
                    {GUARDIAN.noCommentYet}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 课堂反馈 */}
        {timeline.data?.feedback?.length ? (
          <>
            <div className="page-head" style={{ paddingTop: 28 }}>
              <h1>{GUARDIAN.feedbackTitle}</h1>
              <p>{GUARDIAN.everyFourLessons}</p>
            </div>
            <div className="stack">
              {timeline.data.feedback.map((f) => (
                <div key={f.id} className="card flat">
                  <div className="small" style={{ color: 'var(--body)', lineHeight: 1.9 }}>
                    {f.content}
                  </div>
                  {f.teacherComment ? (
                    <div className="notice" style={{ marginTop: 10 }}>
                      {f.teacherComment}
                      {f.nextStep ? <><br />下一步：{f.nextStep}</> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* 孩子收到的留言 */}
        {notes.data?.length ? (
          <>
            <div className="page-head" style={{ paddingTop: 28 }}>
              <h1>{GUARDIAN.notesTitle}</h1>
              <p>{GUARDIAN.notesSubtitle}</p>
            </div>
            <div className="stack">
              {notes.data.map((n) => (
                <div key={n.id} className="card flat">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="chip on">{n.noteType}</span>
                    <span className="tiny muted">来自 {n.fromName}</span>
                    <div className="spacer" />
                    <span className="tiny muted">{new Date(n.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <div className="small">{n.content}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

async function exportData(childId: string): Promise<void> {
  const token = localStorage.getItem('dc.guardian.token');
  const res = await fetch(`/api/guardian/children/${childId}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dreamcity-${childId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function describeContent(content: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(content)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) parts.push(`${k}：${v.join('、')}`);
    else parts.push(`${k}：${String(v)}`);
  }
  return parts.join('　') || '（这次课没有留下作品）';
}
