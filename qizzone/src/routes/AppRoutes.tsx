import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { AuthLayout } from "@/layouts/AuthLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { ExamLayout } from "@/layouts/ExamLayout";
import ProtectedRoute from "@/routes/ProtectedRoute";
import { useAuthStore } from "@/store/authStore";

const Login = lazy(() => import("@/pages/auth/Login"));
const Register = lazy(() => import("@/pages/auth/Register"));
const Unauthorized = lazy(() => import("@/pages/auth/Unauthorized"));
const NotFound = lazy(() => import("@/pages/auth/NotFound"));
const TeacherDashboard = lazy(() => import("@/pages/teacher/TeacherDashboard"));
const CreateQuiz = lazy(() => import("@/pages/teacher/CreateQuiz"));
const QuizList = lazy(() => import("@/pages/teacher/QuizList"));
const QuestionReview = lazy(() => import("@/pages/teacher/QuestionReview"));
const QuizResultsView = lazy(() => import("@/pages/teacher/QuizResultsView"));
const SplitExamEditor = lazy(() => import("@/pages/teacher/SplitExamEditor"));
const StudentDashboard = lazy(() => import("@/pages/student/StudentDashboard"));
const ExamEntry = lazy(() => import("@/pages/student/ExamEntry"));
const QuizRoom = lazy(() => import("@/pages/student/QuizRoom"));
const Result = lazy(() => import("@/pages/student/Result"));
const TeacherApprovals = lazy(() => import("@/pages/admin/TeacherApprovals"));

function RootRedirect() {
  const { user, isAuthenticated, isInitialized } = useAuthStore();
  if (!isInitialized) return <AuthLoading />;
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  const home = user.role === "admin" ? "/admin/teacher-approvals" : user.role === "student" ? "/student" : "/teacher";
  return <Navigate to={home} replace />;
}

function AuthLoading() {
  return <div className="min-h-screen grid place-items-center text-sm text-neutral-500">Đang khôi phục phiên đăng nhập...</div>;
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<AuthLoading />}>
        <Routes>
        {/* Root Redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* Public Auth Routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        {/* Error Pages */}
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Protected Teacher Routes */}
        <Route element={<ProtectedRoute allowedRoles={["teacher", "admin"]} />}>
          <Route element={<DashboardLayout />}>
            <Route path="/teacher" element={<TeacherDashboard />} />
            <Route path="/teacher/create-quiz" element={<CreateQuiz />} />
            <Route path="/teacher/edit-quiz/:quizId" element={<CreateQuiz />} />
            <Route path="/teacher/quizzes" element={<QuizList />} />
            <Route
              path="/teacher/quiz/:quizId/review"
              element={<QuestionReview />}
            />
            <Route
              path="/teacher/quiz/:quizId/results"
              element={<QuizResultsView />}
            />
            <Route
              path="/teacher/extract-quiz"
              element={<SplitExamEditor />}
            />
          </Route>
        </Route>

        {/* Protected Admin Routes */}
        <Route element={<ProtectedRoute allowedRole="admin" />}>
          <Route element={<DashboardLayout />}>
            <Route path="/admin/teacher-approvals" element={<TeacherApprovals />} />
          </Route>
        </Route>

        {/* Student Routes */}
        <Route element={<ProtectedRoute allowedRole="student" />}>
          <Route element={<DashboardLayout />}>
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/student/quiz/:quizId/lobby" element={<ExamEntry />} />
            <Route path="/student/result/:resultId" element={<Result />} />
          </Route>
        </Route>

        {/* Exam Taking Room (Distraction-free ExamLayout) */}
        <Route element={<ProtectedRoute allowedRole="student" />}>
          <Route element={<ExamLayout />}>
            <Route path="/student/quiz/:quizId" element={<QuizRoom />} />
          </Route>
        </Route>

        {/* 404 Catch-all */}
        <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default AppRoutes;
