import { TEACHER } from '@dreamcity/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Empty, TopBar } from '../shared-ui';

const NAV = [
  { to: '/console/lessons', label: TEACHER.nav.lessons },
  { to: '/console/sessions', label: TEACHER.nav.sessions },
  { to: '/console/plugins', label: TEACHER.nav.plugins },
];

interface PluginRow {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  manifest: {
    lesson_refs?: string[];
    mode_cards?: string[];
    duration_min?: number;
    entry?: string;
    offline_fallback?: string;
    result_schema?: Record<string, string>;
  };
}

export function PluginLibrary() {
  const plugins = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api<PluginRow[]>('/api/plugins', { identity: 'staff' }),
  });

  return (
    <div>
      <TopBar nav={NAV} active="/console/plugins" />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <h1>{TEACHER.nav.plugins}</h1>
          <p>
            活动是独立单文件 HTML + manifest，通过 postMessage 回传结果。教研以后加课眼不用等研发排期。
          </p>
        </div>

        {plugins.isLoading ? (
          <Empty>正在加载…</Empty>
        ) : (
          <div className="stack">
            {(plugins.data ?? []).map((p) => (
              <div key={p.id} className="card flat">
                <div className="row">
                  <span className="strong">{p.name}</span>
                  <span className="chip ghost">{p.id}</span>
                  <span className="chip ghost">v{p.version}</span>
                  <div className="spacer" />
                  <a className="btn sm ghost" href={`/activities/${p.manifest.entry}`} target="_blank" rel="noreferrer">
                    单独打开
                  </a>
                </div>
                <div className="grid3" style={{ marginTop: 12 }}>
                  <div>
                    <div className="tiny strong">适用课次</div>
                    <div className="chip-row" style={{ marginTop: 6 }}>
                      {(p.manifest.lesson_refs ?? []).map((r) => (
                        <span key={r} className="chip ghost tiny">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="tiny strong">服务模式卡</div>
                    <div className="chip-row" style={{ marginTop: 6 }}>
                      {(p.manifest.mode_cards ?? []).map((r) => (
                        <span key={r} className="chip on tiny">
                          {r.replace('MODE_', '')}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="tiny strong">断网兜底</div>
                    <div className="small" style={{ marginTop: 6, color: 'var(--body)' }}>
                      {p.manifest.offline_fallback}
                    </div>
                  </div>
                </div>
                <details style={{ marginTop: 12 }}>
                  <summary className="tiny muted" style={{ cursor: 'pointer' }}>
                    查看 result_schema
                  </summary>
                  <pre
                    className="tiny"
                    style={{
                      background: 'var(--paper)',
                      padding: 12,
                      borderRadius: 8,
                      marginTop: 8,
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(p.manifest.result_schema, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
