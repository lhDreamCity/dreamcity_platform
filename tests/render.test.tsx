import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Landing } from '../packages/web/src/landing/Landing';
import { TeacherLogin } from '../packages/web/src/teacher/TeacherLogin';
import { GuardianLogin } from '../packages/web/src/guardian/GuardianLogin';
import { StudentEnter } from '../packages/web/src/student/StudentEnter';
import { LessonLibrary } from '../packages/web/src/teacher/LessonLibrary';
import { PluginLibrary } from '../packages/web/src/teacher/PluginLibrary';
import { SessionList } from '../packages/web/src/teacher/SessionList';

function render(node: React.ReactElement, path = '/'): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('页面能渲染出来', () => {
  it('落地页', () => {
    const html = render(<Landing />);
    expect(html).toContain('梦之城');
    // 合规口径：页面里不应出现学科培训类表述
    expect(html).not.toContain('提分');
    expect(html).not.toContain('补课');
  });

  it('落地页不露出讲师后台入口', () => {
    const html = render(<Landing />);
    expect(html).toContain('家长入口');
    expect(html).toContain('学生入口');
    // 后台走隐藏 URL，落地页不能有它的链接
    expect(html).not.toContain('讲师入口');
    expect(html).not.toContain('/console');
  });

  it('后台登录页', () => {
    const html = render(<TeacherLogin />);
    expect(html).toContain('后台登录');
  });

  it('家长登录页', () => {
    const html = render(<GuardianLogin />);
    expect(html).toContain('家长登录');
  });

  it('学生进入页（不出现密码框）', () => {
    const html = render(<StudentEnter />);
    expect(html).toContain('课堂码');
    expect(html).not.toContain('type="password"');
  });

  it('课次库', () => {
    const html = render(<LessonLibrary />, '/console/lessons');
    expect(html).toContain('课次库');
  });

  it('插件库', () => {
    const html = render(<PluginLibrary />, '/console/plugins');
    expect(html).toContain('插件库');
  });

  it('上课记录', () => {
    const html = render(<SessionList />, '/console/sessions');
    expect(html).toContain('上课记录');
  });
});
