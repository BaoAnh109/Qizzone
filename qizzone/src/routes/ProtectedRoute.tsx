import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import type { Role } from "@/types/auth";

interface ProtectedRouteProps {
  allowedRole?: Role;
  allowedRoles?: Role[];
}

export function ProtectedRoute({
  allowedRole,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuthStore();
  const location = useLocation();

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
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;