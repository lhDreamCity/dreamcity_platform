import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_PHASE_MINUTES,
  GRADE_META,
  MODE_META,
  PHASES,
  TEACHER,
  type ActivityKind,
  type ModeCard,
  type Phase,
} from '@dreamcity/shared';
import { api } from '../lib/api';
import { Empty, LevelChip, TopBar } from '../shared-ui';

const NAV = [
  { to: '/teacher/lessons', label: TEACHER.nav.lessons },
  { to: '/teacher/sessions', label: TEACHER.nav.sessions },
  { to: '/teacher/plugins', label: TEACHER.nav.plugins },
];

interface PlanSegment {
  phase: string;
  canonical: string;
  minutes: number;
  activity: string;
}

interface LessonDetail {
  id: string;
  title: string;
  levelId: string;
  output: string;
  defaultRecipe: string | null;
  currentVersion: number;
  planVersionId: string | null;
  plan: {
    teachingGoal: string;
    coreContent: string;
    segments: PlanSegment[];
    keyQuestion: string;
    classTask: string;
    classOutput: string;
    dualityLink: string;
    criteria: string;
    pitfalls: string;
    homework: string;
  };
}

interface SessionRow {
  id: string;
  lessonId: string;
  lessonTitle: string;
  state: 'DRAFT' | 'LIVE' | 'CLOSED';
  classCode: string | null;
  participantCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

interface PluginRow {
  id: string;
  name: string;
  manifest: { entry?: string; lesson_refs?: string[] };
}

interface DraftActivity {
  key: string;
  phase: Phase;
  modeCard: ModeCard;
  title: string;
  durationMin: number;
  activityKind: ActivityKind;
  pluginId: string | null;
}

const KIND_LABEL: Record<ActivityKind, string> = {
  LESSON_PDF: '课件',
  PLUGIN: '课眼',
  VOTE: '投票',
  TASK: '任务单',
  SUBMIT: '作品提交',
  BREAK: '休息',
};

export function LessonPlanner() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [items, setItems] = useState<DraftActivity[]>([]);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState<ModeCard | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const lesson = useQuery({
    queryKey: ['lesson', id],
    queryFn: () => api<LessonDetail>(`/api/lessons/${id}`, { identity: 'staff' }),
  });

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionRow[]>('/api/sessions', { identity: 'staff' }),
  });

  const plugins = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api<PluginRow[]>('/api/plugins', { identity: 'staff' }),
  });

  // 首次进入：按细案环节生成默认编排
  useEffect(() => {
    if (!lesson.data || items.length > 0) return;
    const segments = lesson.data.plan?.segments ?? [];
    const next: DraftActivity[] = segments.map((s, i) => ({
      key: `${id}-${i}`,
      phase: (s.canonical || s.phase) as Phase,
      modeCard: defaultModeForPhase(s.canonical || s.phase),
      title: s.activity.split(/[：:]/)[0]?.slice(0, 40) || `${s.canonical}环节`,
      durationMin: s.minutes,
      activityKind: kindForPhase(s.canonical || s.phase),
      pluginId: null,
    }));
    setItems(next);
  }, [lesson.data, id, items.length]);

  // 复用已有的草稿会话（备课草稿不重复建）
  useEffect(() => {
    if (!sessions.data || sessionId) return;
    const draft = sessions.data.find((s) => s.lessonId === id && s.state === 'DRAFT');
    if (draft) setSessionId(draft.id);
  }, [sessions.data, id, sessionId]);

  const save = useMutation({
    mutationFn: async () => {
      let sid = sessionId;
      if (!sid) {
        const created = await api<{ id: string }>('/api/sessions', {
          method: 'POST',
          identity: 'staff',
          body: {
            lessonId: id,
            roomName: '待定教室',
            participantCount: 2,
          },
        });
        sid = created.id;
        setSessionId(sid);
      }
      await api(`/api/sessions/${sid}/activities`, {
        method: 'PUT',
        identity: 'staff',
        body: {
          activities: items.map((it) => ({
            phase: it.phase,
            modeCard: it.modeCard,
            title: it.title,
            durationMin: it.durationMin,
            activityKind: it.activityKind,
            pluginId: it.pluginId,
          })),
        },
      });
      return sid;
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const total = useMemo(() => items.reduce((sum, i) => sum + i.durationMin, 0), [items]);
  const lecture = useMemo(
    () =>
      items
        .filter((i) => i.phase === '导入' || i.phase === '讲解')
        .reduce((sum, i) => sum + i.durationMin, 0),
    [items],
  );

  function addCard(mode: ModeCard, phase: Phase) {
    const meta = MODE_META[mode];
    setItems((prev) => [
      ...prev,
      {
        key: `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        phase,
        modeCard: mode,
        title: meta.name,
        durationMin: DEFAULT_PHASE_MINUTES[phase],
        activityKind: kindForPhase(phase),
        pluginId: null,
      },
    ]);
  }

  function move(id: string, phase: Phase) {
    setItems((prev) => prev.map((i) => (i.key === id ? { ...i, phase } : i)));
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.key !== id));
  }

  function setDuration(id: string, minutes: number) {
    setItems((prev) =>
      prev.map((i) => (i.key === id ? { ...i, durationMin: Math.max(1, Math.min(60, minutes)) } : i)),
    );
  }

  function attachPlugin(id: string, pluginId: string | null) {
    setItems((prev) =>
      prev.map((i) =>
        i.key === id
          ? {
              ...i,
              pluginId,
              activityKind: pluginId ? 'PLUGIN' : i.activityKind,
              title: pluginId
                ? (plugins.data?.find((p) => p.id === pluginId)?.name ?? i.title)
                : i.title,
            }
          : i,
      ),
    );
  }

  if (!lesson.data) {
    return (
      <div>
        <TopBar nav={NAV} active="/teacher/lessons" />
        <div className="wrap">
          <Empty>正在加载课次…</Empty>
        </div>
      </div>
    );
  }

  const meta = GRADE_META[lesson.data.levelId as keyof typeof GRADE_META];
  const usablePlugins = (plugins.data ?? []).filter(
    (p) => !p.manifest?.lesson_refs?.length || p.manifest.lesson_refs.includes(lesson.data.id),
  );

  return (
    <div data-level={lesson.data.levelId}>
      <TopBar nav={NAV} active="/teacher/lessons" level={lesson.data.levelId} />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <div className="row" style={{ marginBottom: 6 }}>
            <LevelChip levelId={lesson.data.levelId} />
            <span className="chip ghost">{lesson.data.id}</span>
            <span className="chip ghost">教案 v{lesson.data.currentVersion}</span>
          </div>
          <h1>{lesson.data.title}</h1>
          <p>{TEACHER.planSubtitle}</p>
        </div>

        <div className="row" style={{ marginBottom: 18 }}>
          <span className="chip">合计 {total} 分钟</span>
          <span className={lecture > 25 ? 'chip warm' : 'chip ghost'}>
            讲授 {lecture} 分钟{lecture > 25 ? '（超过 25 分钟上限）' : ''}
          </span>
          {saved ? <span className="chip mint">{TEACHER.savedPlan}</span> : null}
          <div className="spacer" />
          <button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>
            {TEACHER.savePlan}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              save.mutate(undefined, {
                onSuccess: (sid) => navigate(`/teacher/sessions/${sid}`),
              });
            }}
            disabled={save.isPending}
          >
            保存并去开课
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
          {/* ── 模式卡面板 ─────────────────────────── */}
          <div className="card flat">
            <div className="card-title">模式卡</div>
            <p className="card-desc" style={{ marginBottom: 12 }}>
              点一下加到当前环节，或直接拖到右边的环节里。
            </p>
            <div className="stack" style={{ gap: 8 }}>
              {(Object.keys(MODE_META) as ModeCard[]).map((m) => (
                <div
                  key={m}
                  draggable
                  onDragStart={() => setDragging(m)}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => addCard(m, '实操')}
                  className="card flat"
                  style={{
                    cursor: 'grab',
                    borderLeft: `3px solid ${m === 'MODE_M5' || m === 'MODE_M6' ? 'var(--star)' : 'var(--accent)'}`,
                    padding: '10px 12px',
                    opacity: dragging === m ? 0.5 : 1,
                  }}
                >
                  <div className="row tight">
                    <span className="strong small">{MODE_META[m].code} {MODE_META[m].name}</span>
                    {MODE_META[m].teacherOnly ? <span className="chip star tiny">必须真人</span> : null}
                  </div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    {MODE_META[m].failureSignal}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 五环节编排 ─────────────────────────── */}
          <div className="stack">
            {PHASES.map((phase) => {
              const inPhase = items.filter((i) => i.phase === phase);
              const phaseMin = inPhase.reduce((s, i) => s + i.durationMin, 0);
              return (
                <div
                  key={phase}
                  className="card flat"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging) addCard(dragging, phase);
                    setDragging(null);
                  }}
                  style={{ borderColor: dragging ? 'var(--accent)' : 'var(--line)' }}
                >
                  <div className="row" style={{ marginBottom: 10 }}>
                    <span className="badge-num c1">{PHASES.indexOf(phase) + 1}</span>
                    <span className="strong">{phase}</span>
                    <span className="tiny muted">计划 {phaseMin} 分钟</span>
                    {inPhase.length === 0 ? <span className="chip ghost tiny">拖模式卡到这里</span> : null}
                  </div>

                  {inPhase.length === 0 ? (
                    <p className="tiny muted">这个环节还没有安排</p>
                  ) : (
                    <table className="table">
                      <tbody>
                        {inPhase.map((it) => (
                          <tr key={it.key}>
                            <td style={{ width: 120 }}>
                              <select
                                className="input"
                                style={{ padding: '5px 8px', fontSize: 13 }}
                                value={it.modeCard}
                                onChange={(e) => {
                                  const m = e.target.value as ModeCard;
                                  setItems((prev) =>
                                    prev.map((x) =>
                                      x.key === it.key
                                        ? { ...x, modeCard: m, title: MODE_META[m].name }
                                        : x,
                                    ),
                                  );
                                }}
                              >
                                {(Object.keys(MODE_META) as ModeCard[]).map((m) => (
                                  <option key={m} value={m}>
                                    {MODE_META[m].code} {MODE_META[m].name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                className="input"
                                style={{ padding: '5px 8px', fontSize: 13 }}
                                value={it.title}
                                onChange={(e) =>
                                  setItems((prev) =>
                                    prev.map((x) => (x.key === it.key ? { ...x, title: e.target.value } : x)),
                                  )
                                }
                              />
                            </td>
                            <td style={{ width: 96 }}>
                              <select
                                className="input"
                                style={{ padding: '5px 8px', fontSize: 13 }}
                                value={it.activityKind}
                                onChange={(e) =>
                                  setItems((prev) =>
                                    prev.map((x) =>
                                      x.key === it.key
                                        ? { ...x, activityKind: e.target.value as ActivityKind }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
                                  <option key={k} value={k}>
                                    {KIND_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ width: 150 }}>
                              <select
                                className="input"
                                style={{ padding: '5px 8px', fontSize: 13 }}
                                value={it.pluginId ?? ''}
                                onChange={(e) => attachPlugin(it.key, e.target.value || null)}
                              >
                                <option value="">不挂插件</option>
                                {usablePlugins.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ width: 78 }}>
                              <input
                                className="input"
                                style={{ padding: '5px 8px', fontSize: 13 }}
                                type="number"
                                min={1}
                                max={60}
                                value={it.durationMin}
                                onChange={(e) => setDuration(it.key, Number(e.target.value))}
                              />
                            </td>
                            <td style={{ width: 56 }}>
                              <select
                                className="input"
                                style={{ padding: '5px 8px', fontSize: 13 }}
                                value={it.phase}
                                onChange={(e) => move(it.key, e.target.value as Phase)}
                              >
                                {PHASES.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td style={{ width: 44, textAlign: 'right' }}>
                              <button className="btn sm ghost" onClick={() => remove(it.key)}>
                                {TEACHER.removeActivity}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}

            {/* ── 细案（原文）───────────────────────── */}
            <div className="card flat">
              <div className="card-title">细案 · 十字段（原文）</div>
              <div className="grid2" style={{ marginTop: 12 }}>
                {[
                  ['教学目标', lesson.data.plan.teachingGoal],
                  ['核心内容', lesson.data.plan.coreContent],
                  ['关键提问', lesson.data.plan.keyQuestion],
                  ['课堂实操任务', lesson.data.plan.classTask],
                  ['课堂产出', lesson.data.plan.classOutput],
                  ['双主线连接', lesson.data.plan.dualityLink],
                  ['达成标准', lesson.data.plan.criteria],
                  ['常见误区', lesson.data.plan.pitfalls],
                  ['课后延伸与家长反馈', lesson.data.plan.homework],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="tiny strong" style={{ color: 'var(--accent)' }}>
                      {k}
                    </div>
                    <div className="small" style={{ color: 'var(--body)', lineHeight: 1.85 }}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              <div className="tiny muted" style={{ marginTop: 14 }}>
                级别：{meta?.name} · {meta?.gradeRange} · {meta?.theme}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultModeForPhase(phase: string): ModeCard {
  switch (phase) {
    case '导入':
      return 'MODE_M3';
    case '讲解':
      return 'MODE_M1';
    case '实操':
      return 'MODE_M2';
    case '展示':
      return 'MODE_M6';
    default:
      return 'MODE_M1';
  }
}

function kindForPhase(phase: string): ActivityKind {
  switch (phase) {
    case '导入':
      return 'VOTE';
    case '讲解':
      return 'LESSON_PDF';
    case '实操':
      return 'TASK';
    case '展示':
      return 'SUBMIT';
    default:
      return 'BREAK';
  }
}
