import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { GRADE_META, GRADE_LEVELS, TEACHER } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Empty, LevelChip, TopBar } from '../shared-ui';

interface LessonRow {
  id: string;
  unitId: string;
  levelId: string;
  seq: number;
  title: string;
  output: string;
  defaultRecipe: string | null;
  gradeName: string;
}

const NAV = [
  { to: '/console/lessons', label: TEACHER.nav.lessons },
  { to: '/console/sessions', label: TEACHER.nav.sessions },
  { to: '/console/plugins', label: TEACHER.nav.plugins },
];

export function LessonLibrary() {
  const navigate = useNavigate();
  const [level, setLevel] = useState<string>('');
  const [keyword, setKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['lessons', level],
    queryFn: () =>
      api<LessonRow[]>('/api/lessons' + (level ? `?level=${level}` : ''), { identity: 'staff' }),
  });

  const rows = (data ?? []).filter((l) =>
    keyword ? `${l.id} ${l.title}`.includes(keyword) : true,
  );

  // 按级别分组，每级 4 个单元
  const groups = GRADE_LEVELS.map((id) => ({
    id,
    meta: GRADE_META[id],
    units: [1, 2, 3, 4].map((u) => ({
      seq: u,
      name: unitName(id, u),
      lessons: rows.filter((l) => l.levelId === id && l.unitId.endsWith(`U${u}`)),
    })),
  })).filter((g) => g.units.some((u) => u.lessons.length > 0));

  return (
    <div data-level={level || 'GRADE_L1'}>
      <TopBar nav={NAV} active="/console/lessons" level={level || 'GRADE_L1'} />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <h1>{TEACHER.lessonsTitle}</h1>
          <p>{TEACHER.lessonsSubtitle}</p>
        </div>

        <div className="row" style={{ marginBottom: 20 }}>
          <div className="chip-row">
            <button
              className={level === '' ? 'chip on' : 'chip ghost'}
              onClick={() => setLevel('')}
              type="button"
            >
              {TEACHER.levelAll}
            </button>
            {GRADE_LEVELS.map((id) => (
              <button
                key={id}
                className={level === id ? 'chip on' : 'chip ghost'}
                onClick={() => setLevel(id)}
                type="button"
              >
                {GRADE_META[id].code} {GRADE_META[id].name}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="搜课次或标题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {isLoading ? (
          <Empty>正在加载…</Empty>
        ) : rows.length === 0 ? (
          <Empty>没有找到课次</Empty>
        ) : (
          <div className="stack">
            {groups.map((g) => (
              <div key={g.id} data-level={g.id}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <LevelChip levelId={g.id} />
                  <span className="small muted">{g.meta.gradeRange} · {g.meta.theme}</span>
                </div>
                {g.units
                  .filter((u) => u.lessons.length > 0)
                  .map((u) => (
                    <div key={u.seq} className="card flat" style={{ marginBottom: 12 }}>
                      <div className="row" style={{ marginBottom: 10 }}>
                        <span className="badge-num c1">{u.seq}</span>
                        <span className="strong">{u.name}</span>
                        <span className="tiny muted">{u.lessons.length} 节</span>
                      </div>
                      <table className="table">
                        <tbody>
                          {u.lessons.map((l) => (
                            <tr key={l.id}>
                              <td style={{ width: 74, whiteSpace: 'nowrap' }}>
                                <span className="badge-num c2" style={{ width: 22, height: 22, fontSize: 11 }}>
                                  {l.seq}
                                </span>{' '}
                                <span className="tiny muted">{l.id}</span>
                              </td>
                              <td>
                                <Link to={`/console/lessons/${l.id}`} className="strong">
                                  {l.title}
                                </Link>
                                {l.output ? (
                                  <div className="tiny muted" style={{ marginTop: 2 }}>
                                    产出：{l.output}
                                  </div>
                                ) : null}
                              </td>
                              <td style={{ width: 90 }}>
                                {l.defaultRecipe ? <span className="chip ghost">{l.defaultRecipe}</span> : null}
                              </td>
                              <td style={{ width: 92, textAlign: 'right' }}>
                                <Link className="btn sm ghost" to={`/console/lessons/${l.id}`}>
                                  编排
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 28 }}>
          <button className="btn" onClick={() => navigate('/console/sessions')}>
            去上课记录
          </button>
        </div>
      </div>
    </div>
  );
}

/** 单元名与 seed 保持一致 */
function unitName(levelId: string, seq: number): string {
  const map: Record<string, string[]> = {
    GRADE_L1: ['认识 AI', 'AI 动手创作', '钱的秘密', '模拟市集'],
    GRADE_L2: ['AI 的力量', 'AI 创客', '商业认知', '市集与路演'],
    GRADE_L3: ['看懂 AI', '造一个 AI 项目', '商业本质', '产品与路演'],
  };
  return map[levelId]?.[seq - 1] ?? `第 ${seq} 单元`;
}
