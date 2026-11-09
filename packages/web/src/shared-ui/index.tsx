import { BRAND } from '@dreamcity/shared';
import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';

export { Avatar };

export function Mascot({ level = 'GRADE_L1', size = 'md' }: { level?: string; size?: 'sm' | 'md' | 'lg' }) {
  const file = level === 'GRADE_L3' ? 'mascot-L3.png' : level === 'GRADE_L2' ? 'mascot-L2.png' : 'mascot-L1.png';
  const cls = size === 'sm' ? 'mascot sm' : size === 'lg' ? 'mascot lg' : 'mascot';
  return <img className={cls} src={`/assets/${file}`} alt={BRAND.mascot} />;
}

export function TopBar({
  nav,
  active,
  right,
  level,
}: {
  nav: { to: string; label: string }[];
  active: string;
  right?: React.ReactNode;
  level?: string;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <span
            className="brand-mark"
            style={{ background: 'var(--accent)' }}
            aria-hidden="true"
          />
          <span>
            {BRAND.product}
            <small>{BRAND.positioning}</small>
          </span>
        </Link>
        <nav className="topnav">
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className={active === item.to ? 'active' : ''}>
              {item.label}
            </Link>
          ))}
        </nav>
        {right ? <div className="row tight" style={{ marginLeft: 12 }}>{right}</div> : null}
      </div>
    </header>
  );
}

export function PageHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <div className="notice">{children}</div>;
}

export function LevelChip({ levelId }: { levelId: string | null }) {
  if (!levelId) return <span className="chip ghost">级别待定</span>;
  const map: Record<string, string> = {
    GRADE_L1: 'L1 启蒙级',
    GRADE_L2: 'L2 进阶级',
    GRADE_L3: 'L3 实战级',
  };
  return <span className="chip">{map[levelId] ?? levelId}</span>;
}

/** 可见范围标签 —— 家长与讲师看得到「这件作品给谁看」 */
export function ScopeChip({ scope }: { scope: string }) {
  const map: Record<string, string> = {
    VIS_L0: '私密',
    VIS_L1: '本班',
    VIS_L2: '跨期',
    VIS_L3: '对外',
  };
  const cls = scope === 'VIS_L0' ? 'chip ghost' : scope === 'VIS_L3' ? 'chip warm' : 'chip on';
  return <span className={cls}>{map[scope] ?? scope}</span>;
}
