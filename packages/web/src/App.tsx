import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from './landing/Landing';
import { TeacherLogin } from './teacher/TeacherLogin';
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

        {/* 讲师端 */}
        <Route path="/teacher/login" element={<TeacherLogin />} />
        <Route path="/teacher/lessons" element={<LessonLibrary />} />
        <Route path="/teacher/lessons/:id" element={<LessonPlanner />} />
        <Route path="/teacher/sessions" element={<SessionList />} />
        <Route path="/teacher/sessions/:id" element={<Cockpit />} />
        <Route path="/teacher/plugins" element={<PluginLibrary />} />
        <Route path="/teacher/students" element={<StudentDirectory />} />

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
