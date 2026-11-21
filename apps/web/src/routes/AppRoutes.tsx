import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { AuthLayout } from "@/layouts/AuthLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { ExamLayout } from "@/layouts/ExamLayout";
import ProtectedRoute from "@/routes/ProtectedRoute";
import GuestRoute from "@/routes/GuestRoute";
import { useAuthStore } from "@/store/authStore";
import { getRoleHomeRoute } from "@/routes/navigation";
import { AuthLoadingFallback, RouteLoadingFallback } from "@/components/common/RouteLoadingFallback";

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
const PracticeHistory = lazy(() => import("@/pages/student/PracticeHistory"));
const PracticeSetup = lazy(() => import("@/pages/student/PracticeSetup"));
const PracticeRoom = lazy(() => import("@/pages/student/PracticeRoom"));
const PracticeResult = lazy(() => import("@/pages/student/PracticeResult"));
const ExamEntry = lazy(() => import("@/pages/student/ExamEntry"));
const QuizRoom = lazy(() => import("@/pages/student/QuizRoom"));
const Result = lazy(() => import("@/pages/student/Result"));
const TeacherApprovals = lazy(() => import("@/pages/admin/TeacherApprovals"));
const AccountManagement = lazy(() => import("@/pages/admin/AccountManagement"));
const JoinByLink = lazy(() => import("@/pages/student/JoinByLink"));

function RootRedirect() {
  const { user, isAuthenticated, isInitialized } = useAuthStore();
  if (!isInitialized) return <AuthLoadingFallback />;
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={getRoleHomeRoute(user.role)} replace />;
}

function QuizRedirect() {
  const { quizId } = useParams();
  return <Navigate to={`/student/quiz/${quizId}/lobby`} replace />;
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          {/* Root Redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* Public Auth Routes protected by GuestRoute */}
          <Route element={<GuestRoute />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
            </Route>
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
              <Route path="/admin/accounts" element={<AccountManagement />} />
            </Route>
          </Route>

          {/* Direct Join Link & Quiz Aliases */}
          <Route path="/join" element={<JoinByLink />} />
          <Route path="/join/:code" element={<JoinByLink />} />
          <Route path="/quiz/:quizId" element={<QuizRedirect />} />
          <Route path="/exam/:quizId" element={<QuizRedirect />} />

          {/* Student Dashboard Route (Only Students) */}
          <Route element={<ProtectedRoute allowedRole="student" />}>
            <Route element={<DashboardLayout />}>
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/student/practice" element={<PracticeHistory />} />
              <Route path="/student/practice/:quizId" element={<PracticeSetup />} />
              <Route path="/student/practice/:sessionId/result" element={<PracticeResult />} />
            </Route>
            <Route element={<ExamLayout mode="practice" />}>
              <Route path="/student/practice/:sessionId/room" element={<PracticeRoom />} />
            </Route>
          </Route>

          {/* Exam Taking & Lobby (Accessible by student, teacher previewing/testing room, and admin) */}
          <Route element={<ProtectedRoute allowedRoles={["student", "teacher", "admin"]} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/student/quiz/:quizId/lobby" element={<ExamEntry />} />
              <Route path="/student/result/:resultId" element={<Result />} />
            </Route>
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
