import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isTokenLive } from '../lib/api';

/**
 * 后台路由闸门
 *
 * 讲师后台是「隐藏 URL + 账号密码」双闸：URL 不在落地页出现，
 * 页面本身还要令牌才能进。令牌不在或已过期 —— 直接送回登录页，
 * 别让人对着半登录的界面发呆。
 */
export function StaffGate({ children }: { children: ReactNode }) {
  if (!isTokenLive('staff')) {
    return <Navigate to="/console" replace />;
  }
  return <>{children}</>;
}
