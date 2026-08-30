import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { AuthLayout } from "@/layouts/AuthLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { ExamLayout } from "@/layouts/ExamLayout";

import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Unauthorized from "@/pages/auth/Unauthorized";
import NotFound from "@/pages/auth/NotFound";

import TeacherDashboard from "@/pages/teacher/TeacherDashboard";
import CreateQuiz from "@/pages/teacher/CreateQuiz";
import QuizList from "@/pages/teacher/QuizList";
import QuestionReview from "@/pages/teacher/QuestionReview";

import StudentDashboard from "@/pages/student/StudentDashboard";
import QuizRoom from "@/pages/student/QuizRoom";
import Result from "@/pages/student/Result";

import DesignSystemShowcase from "@/pages/DesignSystemShowcase";
import ProtectedRoute from "@/routes/ProtectedRoute";
import { useAuthStore } from "@/store/authStore";

function RootRedirect() {
  const { user, isAuthenticated } = useAuthStore();
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={user.role === "teacher" ? "/teacher" : "/student"} replace />;
}

export function AppRoutes() {
  return (
    <BrowserRouter>
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

        {/* Design System Showcase */}
        <Route element={<DashboardLayout />}>
          <Route path="/design-system" element={<DesignSystemShowcase />} />
        </Route>

        {/* Protected Teacher Routes */}
        <Route element={<ProtectedRoute allowedRole="teacher" />}>
          <Route element={<DashboardLayout />}>
            <Route path="/teacher" element={<TeacherDashboard />} />
            <Route path="/teacher/create-quiz" element={<CreateQuiz />} />
            <Route path="/teacher/edit-quiz/:quizId" element={<CreateQuiz />} />
            <Route path="/teacher/quizzes" element={<QuizList />} />
            <Route
              path="/teacher/quiz/:quizId/review"
              element={<QuestionReview />}
            />
          </Route>
        </Route>

        {/* Student Routes */}
        <Route element={<ProtectedRoute allowedRole="student" />}>
          <Route element={<DashboardLayout />}>
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/student/result/:resultId" element={<Result />} />
          </Route>
        </Route>

        {/* Exam Taking Room (Distraction-free ExamLayout) */}
        <Route element={<ExamLayout />}>
          <Route path="/student/quiz/:quizId" element={<QuizRoom />} />
        </Route>

        {/* 404 Catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRoutes;