import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GUARDIAN, AVATAR_KEYS, type ConsentState } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Avatar } from '../shared-ui';

const GRADES = [3, 4, 5, 6, 7, 8, 9];

const CONSENT_ITEMS: { key: keyof ConsentState; title: string; desc: string }[] = [
  { key: 'data', title: GUARDIAN.consentData, desc: GUARDIAN.consentDataDesc },
  { key: 'wall', title: GUARDIAN.consentWall, desc: GUARDIAN.consentWallDesc },
  { key: 'media', title: GUARDIAN.consentMedia, desc: GUARDIAN.consentMediaDesc },
  { key: 'crossTerm', title: GUARDIAN.consentCrossTerm, desc: GUARDIAN.consentCrossTermDesc },
];

/**
 * 添加孩子 —— 监护人完成注册
 *
 * 这是封闭域内的注册：需要家长已登录（手机号验证过），
 * 每一项可见范围逐项勾选，且随时可撤回。
 */
export function AddChild({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState(4);
  const [avatarKey, setAvatarKey] = useState<string>(AVATAR_KEYS[0]!);
  const [consents, setConsents] = useState<ConsentState>({
    wall: true,
    media: false,
    data: true,
    crossTerm: false,
  });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      return api('/api/guardian/children', {
        method: 'POST',
        identity: 'guardian',
        body: { displayName: name.trim(), grade, avatarKey, consents },
      });
    },
    onSuccess: () => {
      setDone(true);
      qc.invalidateQueries({ queryKey: ['guardian-children'] });
      setTimeout(() => onDone?.(), 1600);
    },
    onError: (err) => setError((err as Error).message),
  });

  if (done) {
    return (
      <div className="card center" style={{ borderColor: 'var(--mint)' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--mint)' }}>
          {GUARDIAN.addChildDone}
        </div>
        <p className="card-desc" style={{ marginTop: 8 }}>
          {GUARDIAN.addChildDoneHint}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">{GUARDIAN.addChildTitle}</div>
      <p className="card-desc">{GUARDIAN.addChildSubtitle}</p>

      <div style={{ marginTop: 18 }}>
        <div className="field">
          <label htmlFor="child-name">{GUARDIAN.addChildName}</label>
          <input
            id="child-name"
            className="input"
            maxLength={10}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={GUARDIAN.addChildNameHint}
          />
        </div>

        <div className="field">
          <label>{GUARDIAN.addChildGrade}</label>
          <div className="row tight">
            {GRADES.map((g) => (
              <button
                key={g}
                type="button"
                className={g === grade ? 'chip on' : 'chip ghost'}
                onClick={() => setGrade(g)}
              >
                {g} 年级
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{GUARDIAN.addChildAvatar}</label>
          <div className="row tight" style={{ gap: 8 }}>
            {AVATAR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setAvatarKey(k)}
                style={{
                  background: k === avatarKey ? 'var(--paper-2)' : 'transparent',
                  border: k === avatarKey ? '2px solid var(--accent)' : '2px solid transparent',
                  borderRadius: 12,
                  padding: 4,
                  cursor: 'pointer',
                }}
                aria-label={`头像 ${k}`}
              >
                <Avatar avatarKey={k} size={40} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 16 }}>
        <div className="strong small">{GUARDIAN.addChildConsentTitle}</div>
        <p className="tiny muted" style={{ marginTop: 4, marginBottom: 12 }}>
          {GUARDIAN.addChildConsentSubtitle}
        </p>

        <div className="stack" style={{ gap: 8 }}>
          {CONSENT_ITEMS.map((item) => (
            <label
              key={item.key}
              className="card flat"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                cursor: 'pointer',
                padding: '12px 14px',
              }}
            >
              <input
                type="checkbox"
                checked={consents[item.key]}
                onChange={(e) =>
                  setConsents((c) => ({ ...c, [item.key]: e.target.checked }))
                }
                style={{ marginTop: 3, accentColor: 'var(--accent)', width: 18, height: 18 }}
              />
              <span>
                <span className="small strong">{item.title}</span>
                <br />
                <span className="tiny muted">{item.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {error ? (
        <div className="notice" style={{ marginTop: 14 }}>
          {error}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        {onDone ? (
          <button className="btn ghost" type="button" onClick={onDone}>
            {GUARDIAN.addChildCancel}
          </button>
        ) : null}
        <button
          className="btn"
          type="button"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {GUARDIAN.addChildSubmit}
        </button>
      </div>
    </div>
  );
}
