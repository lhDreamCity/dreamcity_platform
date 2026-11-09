import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONSENT_SCOPES, GUARDIAN, type ConsentScope, type ConsentState } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Empty, ScopeChip, TopBar } from '../shared-ui';

const NAV = [
  { to: '/guardian', label: '孩子的课堂' },
  { to: '/guardian/settings', label: '可见范围与授权' },
];

const CONSENT_LABELS: { scope: ConsentScope; title: string; desc: string }[] = [
  { scope: '数据', title: GUARDIAN.consentData, desc: GUARDIAN.consentDataDesc },
  { scope: '作品上墙', title: GUARDIAN.consentWall, desc: GUARDIAN.consentWallDesc },
  { scope: '影像', title: GUARDIAN.consentMedia, desc: GUARDIAN.consentMediaDesc },
  { scope: '跨期', title: GUARDIAN.consentCrossTerm, desc: GUARDIAN.consentCrossTermDesc },
];

interface GrantsResponse {
  VIS_L1: boolean;
  VIS_L2: boolean;
  VIS_L3: boolean;
  items: {
    id: string;
    scope: string;
    artifactId: string | null;
    grantedAt: string;
    revokedAt: string | null;
  }[];
}

interface TimelineItem {
  id: string;
  title: string;
  visibility: string;
  createdAt: string;
}

export function GrantSettings() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');

  const grants = useQuery({
    queryKey: ['guardian-grants', id],
    queryFn: () => api<GrantsResponse>(`/api/guardian/children/${id}/grants`, { identity: 'guardian' }),
    enabled: !!id,
  });

  const timeline = useQuery({
    queryKey: ['guardian-timeline', id],
    queryFn: () =>
      api<{ items: TimelineItem[] }>(`/api/guardian/children/${id}/timeline`, { identity: 'guardian' }),
    enabled: !!id,
  });

  const mutate = useMutation({
    mutationFn: async (payload: { scope: string; artifactId?: string | null; revoke?: boolean }) => {
      if (payload.revoke) {
        return api<{ revoked: number }>(`/api/guardian/children/${id}/grants/revoke`, {
          method: 'POST',
          identity: 'guardian',
          body: { scope: payload.scope, artifactId: payload.artifactId ?? null },
        });
      }
      return api(`/api/guardian/children/${id}/grants`, {
        method: 'POST',
        identity: 'guardian',
        body: { scope: payload.scope, artifactId: payload.artifactId ?? null },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guardian-grants', id] });
      qc.invalidateQueries({ queryKey: ['guardian-timeline', id] });
      setMessage('已经保存');
      setTimeout(() => setMessage(''), 2000);
    },
    onError: (err) => {
      setMessage((err as Error).message);
      setTimeout(() => setMessage(''), 3000);
    },
  });

  /** 监护人知情同意：逐项可撤回 */
  const toggleConsent = useMutation({
    mutationFn: async (payload: { scope: ConsentScope; granted: boolean }) => {
      return api(`/api/guardian/children/${id}/consents`, {
        method: 'POST',
        identity: 'guardian',
        body: payload,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guardian-children'] });
      qc.invalidateQueries({ queryKey: ['guardian-grants', id] });
      setMessage('已经保存');
      setTimeout(() => setMessage(''), 2000);
    },
    onError: (err) => {
      setMessage((err as Error).message);
      setTimeout(() => setMessage(''), 3000);
    },
  });

  const children = useQuery({
    queryKey: ['guardian-children'],
    queryFn: () => api<{ id: string; consents?: ConsentState }[]>('/api/guardian/children', { identity: 'guardian' }),
  });
  const child = children.data?.find((c) => c.id === id);
  const consents: ConsentState = child?.consents ?? {
    wall: false,
    media: false,
    data: false,
    crossTerm: false,
  };

  if (!grants.data) {
    return (
      <div>
        <TopBar nav={NAV} active="/guardian/settings" />
        <div className="wrap">
          <Empty>正在加载…</Empty>
        </div>
      </div>
    );
  }

  const rows: { scope: 'VIS_L1' | 'VIS_L2' | 'VIS_L3'; title: string; desc: string }[] = [
    { scope: 'VIS_L1', title: GUARDIAN.grantL1, desc: GUARDIAN.grantL1Desc },
    { scope: 'VIS_L2', title: GUARDIAN.grantL2, desc: GUARDIAN.grantL2Desc },
    { scope: 'VIS_L3', title: GUARDIAN.grantL3, desc: GUARDIAN.grantL3Desc },
  ];

  return (
    <div>
      <TopBar nav={NAV} active="/guardian/settings" />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <h1>{GUARDIAN.grantsTitle}</h1>
          <p>{GUARDIAN.grantsSubtitle}</p>
        </div>

        {message ? (
          <div className="notice" style={{ marginBottom: 16 }}>
            {message}
          </div>
        ) : null}

        <div className="stack">
          {rows.map((r) => {
            const on = grants.data[r.scope];
            return (
              <div key={r.scope} className="card flat">
                <div className="row">
                  <ScopeChip scope={r.scope} />
                  <span className="strong">{r.title}</span>
                  <div className="spacer" />
                  {on ? <span className="chip mint">{GUARDIAN.granted}</span> : <span className="chip ghost">未开启</span>}
                  <button
                    className={`btn sm ${on ? 'ghost' : ''}`}
                    onClick={() => mutate.mutate({ scope: r.scope, revoke: on })}
                    disabled={mutate.isPending}
                  >
                    {on ? GUARDIAN.revoke : GUARDIAN.grant}
                  </button>
                </div>
                <p className="card-desc" style={{ marginTop: 8 }}>
                  {r.desc}
                </p>
              </div>
            );
          })}
        </div>

        {/* ── 监护人知情同意：逐项可撤回 ────────────────────── */}
        <div className="page-head" style={{ paddingTop: 28 }}>
          <h1 style={{ fontSize: 22 }}>{GUARDIAN.addChildConsentTitle}</h1>
          <p>{GUARDIAN.addChildConsentSubtitle}</p>
        </div>

        <div className="stack">
          {CONSENT_LABELS.map((c) => {
            const on = consents[c.scope as keyof ConsentState];
            return (
              <div key={c.scope} className="card flat">
                <div className="row">
                  <span className="strong small">{c.title}</span>
                  <div className="spacer" />
                  {on ? <span className="chip mint">{GUARDIAN.granted}</span> : <span className="chip ghost">未同意</span>}
                  <button
                    className={`btn sm ${on ? 'ghost' : ''}`}
                    onClick={() =>
                      toggleConsent.mutate({ scope: c.scope, granted: !on })
                    }
                    disabled={toggleConsent.isPending}
                  >
                    {on ? GUARDIAN.revoke : GUARDIAN.grant}
                  </button>
                </div>
                <p className="card-desc" style={{ marginTop: 8 }}>
                  {c.desc}
                </p>
              </div>
            );
          })}
        </div>

        {/* VIS_L3 逐件授权 */}
        <div className="page-head" style={{ paddingTop: 28 }}>
          <h1 style={{ fontSize: 22 }}>对外分享 · 逐件授权</h1>
          <p>每件作品单独决定要不要生成对外链接。带水印，随时可撤回。</p>
        </div>

        <div className="card flat">
          <table className="table">
            <thead>
              <tr>
                <th>作品</th>
                <th>当前范围</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(timeline.data?.items ?? []).map((item) => {
                const granted = grants.data.items.some(
                  (g) => g.scope === 'VIS_L3' && g.artifactId === item.id && !g.revokedAt,
                );
                return (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>
                      <ScopeChip scope={item.visibility} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className={`btn sm ${granted ? 'ghost' : ''}`}
                        onClick={() =>
                          mutate.mutate({ scope: 'VIS_L3', artifactId: item.id, revoke: granted })
                        }
                        disabled={mutate.isPending}
                      >
                        {granted ? GUARDIAN.revoke : '允许对外分享'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 导出与注销 */}
        <div className="page-head" style={{ paddingTop: 28 }}>
          <h1 style={{ fontSize: 22 }}>{GUARDIAN.exportTitle}</h1>
          <p>{GUARDIAN.exportDesc}</p>
        </div>
        <div className="card flat">
          <div className="row">
            <a className="btn ghost" href={`/api/guardian/children/${id}/export`} target="_blank" rel="noreferrer">
              {GUARDIAN.export}
            </a>
            <div className="spacer" />
          </div>
          <p className="card-desc" style={{ marginTop: 12 }}>
            {GUARDIAN.deleteDesc}
          </p>
        </div>
      </div>
    </div>
  );
}
