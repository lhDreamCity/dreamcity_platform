import { BRAND, GRADE_META, GRADE_LEVELS } from '@dreamcity/shared';
import { Link } from 'react-router-dom';

/**
 * 品牌落地页
 *
 * 合规口径（硬约束 C1）：只讲「AI 素养 / 科技素养」，不写学科类培训表述。
 */
export function Landing() {
  return (
    <div className="deep-bg" style={{ minHeight: '100vh' }}>
      <div className="wrap" style={{ paddingTop: 56, paddingBottom: 56 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 40 }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <span className="chip">{BRAND.alias}</span>
            <h1 style={{ fontSize: 40, fontWeight: 800, margin: '18px 0 10px', lineHeight: 1.25 }}>
              {BRAND.positioning}
            </h1>
            <p style={{ color: 'var(--deep-sub)', fontSize: 17, maxWidth: 620, lineHeight: 1.9 }}>
              {BRAND.tagline}
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 18, maxWidth: 620, lineHeight: 1.9 }}>
              线下 90 分钟，一人一机，把课堂变成可复用的编排、把成果变成看得见的成长证据。
              老师不用填表，孩子有作品可带走，家长能看到每一步。
            </p>

            <div className="row" style={{ marginTop: 28 }}>
              <Link className="btn deep" to="/guardian/login">家长入口</Link>
              <Link className="btn deep" to="/student/enter">学生入口</Link>
            </div>

            <div className="chip-row" style={{ marginTop: 32 }}>
              {GRADE_LEVELS.map((id) => {
                const meta = GRADE_META[id];
                return (
                  <span
                    key={id}
                    className="chip ghost"
                    style={{ background: 'rgba(255,255,255,.08)', color: 'var(--deep-sub)', borderColor: 'var(--deep-line)' }}
                  >
                    {meta.code} {meta.name} · {meta.gradeRange}
                  </span>
                );
              })}
            </div>
          </div>

          {/* 课程结构：给家长看的正经信息，不用吉祥物 */}
          <div
            style={{
              width: 320,
              flex: 'none',
              border: '1px solid var(--deep-line)',
              borderRadius: 16,
              overflow: 'hidden',
              background: 'rgba(255,255,255,.04)',
            }}
          >
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid var(--deep-line)',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--star)',
              }}
            >
              三个级别 · 各 16 节课
            </div>
            {GRADE_LEVELS.map((id) => {
              const meta = GRADE_META[id];
              return (
                <div key={id} style={{ padding: '13px 18px', borderBottom: '1px solid var(--deep-line)' }}>
                  <div className="row tight">
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: 'var(--deep)',
                        background: id === 'GRADE_L1' ? '#2E7CF6' : id === 'GRADE_L2' ? '#7C6BFF' : '#F2A33C',
                        borderRadius: 6,
                        padding: '2px 8px',
                      }}
                    >
                      {meta.code}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{meta.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                      {meta.gradeRange}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--deep-sub)', marginTop: 6 }}>{meta.theme}</div>
                </div>
              );
            })}
            <div style={{ padding: '13px 18px' }}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.9 }}>
                AI 应用线 × 商业思维线双主线。
                第 8 节产出 AI 作品，第 16 节做真实商业实战。
              </div>
            </div>
          </div>
        </div>

        <div className="grid3" style={{ marginTop: 56 }}>
          {[
            {
              t: '课堂操作系统，不是网课',
              d: '第一用户是讲师。平台让线下 90 分钟跑得更顺，并把课堂自动沉淀成资产 —— 不替代课堂。',
            },
            {
              t: '双主线：AI 应用 × 商业思维',
              d: '每期第 8 节产出 AI 作品，第 16 节做真实商业实战。家长看到的是「孩子做出了什么、讲得清什么」。',
            },
            {
              t: '有围墙的成长档案',
              d: '数据不出机构，没有点赞数、没有排行榜、没有陌生人。孩子被看见，但不会去追热度。',
            },
          ].map((c) => (
            <div
              key={c.t}
              style={{
                background: 'rgba(255,255,255,.05)',
                border: '1px solid var(--deep-line)',
                borderRadius: 18,
                padding: '20px 22px',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8, color: 'var(--star)' }}>{c.t}</div>
              <div style={{ fontSize: 13.5, color: 'var(--deep-sub)', lineHeight: 1.9 }}>{c.d}</div>
            </div>
          ))}
        </div>

        <footer style={{ marginTop: 56, fontSize: 12, color: 'var(--muted)' }}>
          {BRAND.company} · {BRAND.alias}
        </footer>
      </div>
    </div>
  );
}
