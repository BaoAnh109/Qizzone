import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { getPostLoginRedirect } from "@/routes/navigation";
import { AuthLoadingFallback } from "@/components/common/RouteLoadingFallback";

export function GuestRoute() {
  const { user, isAuthenticated, isInitialized } = useAuthStore();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect");

  if (!isInitialized) {
    return <AuthLoadingFallback />;
  }

  if (isAuthenticated && user) {
    const destination = getPostLoginRedirect(user.role, redirect);
    return <Navigate to={destination} replace />;
  }

  return <Outlet />;
}

export default GuestRoute;
