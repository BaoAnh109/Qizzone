import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import type { Role } from "@/types/auth";
import { getRoleHomeRoute } from "@/routes/navigation";
import { AuthLoadingFallback } from "@/components/common/RouteLoadingFallback";

interface ProtectedRouteProps {
  allowedRole?: Role;
  allowedRoles?: Role[];
}

export function ProtectedRoute({
  allowedRole,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, isAuthenticated, isInitialized, configurationError } = useAuthStore();
  const location = useLocation();

  if (!isInitialized) {
    return <AuthLoadingFallback />;
  }

  if (configurationError && !isAuthenticated) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-lg space-y-2">
          <h1 className="text-xl font-bold text-neutral-900">Chưa thể kết nối dịch vụ</h1>
          <p className="text-sm text-neutral-600">{configurationError}</p>
          <p className="text-xs text-neutral-500">Kiểm tra các biến VITE_FIREBASE_* và VITE_SUPABASE_* trong file .env rồi tải lại trang.</p>
        </div>
      </div>
    );
  }

  // Not logged in -> redirect to login with return path
  if (!isAuthenticated || !user) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  // Check role authorization
  const roles = allowedRoles || (allowedRole ? [allowedRole] : []);
  if (roles.length > 0 && !roles.includes(user.role)) {
    // Graceful fallback to user's home portal instead of 403 error page
    const fallbackPath = getRoleHomeRoute(user.role);
    return <Navigate to={fallbackPath} replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
