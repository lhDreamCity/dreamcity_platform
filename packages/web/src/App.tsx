import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './landing/Landing';
import { TeacherLogin } from './teacher/TeacherLogin';
import { StaffGate } from './teacher/StaffGate';
import { LessonLibrary } from './teacher/LessonLibrary';
import { LessonPlanner } from './teacher/LessonPlanner';
import { SessionList } from './teacher/SessionList';
import { Cockpit } from './teacher/Cockpit';
import { PluginLibrary } from './teacher/PluginLibrary';
import { StudentDirectory } from './teacher/StudentDirectory';
import { GuardianLogin } from './guardian/GuardianLogin';
import { GuardianHome } from './guardian/GuardianHome';
import { GrantSettings } from './guardian/GrantSettings';
import { StudentEnter } from './student/StudentEnter';
import { StudentSession } from './student/StudentSession';
import { StudentShowcase } from './student/StudentShowcase';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />

        {/*
          讲师 / 运营后台 —— 隐藏 URL。
          落地页不提供任何入口，只能直接敲地址进来；进来还得过账号密码这一关。
        */}
        <Route path="/console" element={<TeacherLogin />} />
        <Route
          path="/console/lessons"
          element={
            <StaffGate>
              <LessonLibrary />
            </StaffGate>
          }
        />
        <Route
          path="/console/lessons/:id"
          element={
            <StaffGate>
              <LessonPlanner />
            </StaffGate>
          }
        />
        <Route
          path="/console/sessions"
          element={
            <StaffGate>
              <SessionList />
            </StaffGate>
          }
        />
        <Route
          path="/console/sessions/:id"
          element={
            <StaffGate>
              <Cockpit />
            </StaffGate>
          }
        />
        <Route
          path="/console/plugins"
          element={
            <StaffGate>
              <PluginLibrary />
            </StaffGate>
          }
        />
        <Route
          path="/console/students"
          element={
            <StaffGate>
              <StudentDirectory />
            </StaffGate>
          }
        />

        {/* 家长端 */}
        <Route path="/guardian/login" element={<GuardianLogin />} />
        <Route path="/guardian" element={<GuardianHome />} />
        <Route path="/guardian/children/:id" element={<GuardianHome />} />
        <Route path="/guardian/children/:id/grants" element={<GrantSettings />} />

        {/* 学生端 */}
        <Route path="/student/enter" element={<StudentEnter />} />
        <Route path="/student/session" element={<StudentSession />} />
        <Route path="/student/showcase" element={<StudentShowcase />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
