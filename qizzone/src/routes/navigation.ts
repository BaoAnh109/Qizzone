import type { UserRole } from "@/types/auth";

export function getRoleHomeRoute(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/admin/teacher-approvals";
    case "teacher":
      return "/teacher";
    case "student":
    default:
      return "/student";
  }
}

/**
 * Resolves destination URL after login based on user role to avoid 403 forbidden redirects.
 * Allows teachers and admins to preview/access shared exam rooms and lobby.
 */
export function getPostLoginRedirect(role: UserRole, redirectParam: string | null | undefined): string {
  const home = getRoleHomeRoute(role);

  if (
    !redirectParam ||
    redirectParam === "/login" ||
    redirectParam === "/register" ||
    redirectParam === "/unauthorized"
  ) {
    return home;
  }

  // Prevent non-admins from hitting admin routes
  if (redirectParam.startsWith("/admin") && role !== "admin") {
    return home;
  }

  // Prevent students from hitting teacher-management routes
  if (redirectParam.startsWith("/teacher") && role === "student") {
    return "/student";
  }

  // Teachers/Admins hitting student routes: allow previewing quiz lobbies, taking test exams, or viewing results
  if (redirectParam.startsWith("/student") && role !== "student") {
    const isExamOrResult =
      redirectParam.startsWith("/student/quiz/") ||
      redirectParam.startsWith("/student/result/");
    if (!isExamOrResult) {
      return home;
    }
  }

  return redirectParam;
}

/**
 * Preloads target dashboard chunk into browser cache during login
 * to ensure 0ms latency when navigating post-login.
 */
export function preloadDashboardForRole(role: UserRole): void {
  try {
    if (role === "student") {
      void import("@/pages/student/StudentDashboard");
    } else if (role === "teacher") {
      void import("@/pages/teacher/TeacherDashboard");
    } else if (role === "admin") {
      void import("@/pages/admin/TeacherApprovals");
    }
  } catch {
    // Non-blocking prefetch failure
  }
}
