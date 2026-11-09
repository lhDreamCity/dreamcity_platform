import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TEACHER } from '@dreamcity/shared';
import { api } from '../lib/api';
import { Avatar, Empty, TopBar } from '../shared-ui';

const NAV = [
  { to: '/console/lessons', label: TEACHER.nav.lessons },
  { to: '/console/sessions', label: TEACHER.nav.sessions },
  { to: '/console/students', label: TEACHER.nav.students },
  { to: '/console/plugins', label: TEACHER.nav.plugins },
];

interface StudentRow {
  id: string;
  displayName: string;
  avatarKey: string;
  avatarStage: number;
  grade: number;
  levelId: string | null;
  state: string;
  guardianName: string;
  phoneTail: string;
  inSession: boolean;
}

/**
 * 学员名册
 *
 * 家长端「添加孩子」之后，孩子就会出现在这里。
 * 讲师从这里挑人、开课点名 —— 这是「学生注册 → 当堂登录」闭环的中间一环。
 */
export function StudentDirectory() {
  const [keyword, setKeyword] = useState('');

  const students = useQuery({
    queryKey: ['students', keyword],
    queryFn: () =>
      api<StudentRow[]>(`/api/students${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`, {
        identity: 'staff',
      }),
  });

  const rows = students.data ?? [];

  return (
    <div>
      <TopBar nav={NAV} active="/console/students" />
      <div className="wrap" style={{ paddingBottom: 60 }}>
        <div className="page-head">
          <h1>{TEACHER.studentsTitle}</h1>
          <p>{TEACHER.studentsSubtitle}</p>
        </div>

        <div className="row" style={{ marginBottom: 18 }}>
          <input
            className="input"
            style={{ maxWidth: 300 }}
            placeholder={TEACHER.searchStudents}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="spacer" />
          <span className="chip ghost">{rows.length} 人</span>
        </div>

        {students.isLoading ? (
          <Empty>正在加载…</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            {keyword ? '没有找到匹配的孩子' : TEACHER.studentsEmpty}
          </Empty>
        ) : (
          <div className="card flat">
            <table className="table">
              <thead>
                <tr>
                  <th>孩子</th>
                  <th>年级</th>
                  <th>家长</th>
                  <th>手机号后四位</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="row tight">
                        <Avatar avatarKey={s.avatarKey} stage={s.avatarStage} size={32} />
                        <span className="strong">{s.displayName}</span>
                      </div>
                    </td>
                    <td>{s.grade} 年级</td>
                    <td>{s.guardianName}</td>
                    <td className="tiny muted">{s.phoneTail}</td>
                    <td>
                      {s.state === 'ACTIVE' ? (
                        s.inSession ? (
                          <span className="chip mint">{TEACHER.inClass}</span>
                        ) : (
                          <span className="chip ghost">{TEACHER.notInAnyClass}</span>
                        )
                      ) : (
                        <span className="chip ghost">已停用</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
