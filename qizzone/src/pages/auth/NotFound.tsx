import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Compass, Home, ArrowLeft, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/store/authStore";

export function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  const [countdown, setCountdown] = useState<number>(5);
  const [autoRedirectEnabled, setAutoRedirectEnabled] = useState<boolean>(true);

  const homePath = !isAuthenticated || !user
    ? "/login"
    : user.role === "admin"
      ? "/admin/teacher-approvals"
      : user.role === "student"
        ? "/student"
        : "/teacher";

  const homeLabel = !isAuthenticated || !user
    ? "Về trang đăng nhập"
    : user.role === "admin"
      ? "Về trang quản trị"
      : user.role === "student"
        ? "Về sảnh học sinh"
        : "Về trang giáo viên";

  // Auto-route back to appropriate portal after countdown
  useEffect(() => {
    if (!autoRedirectEnabled || !isInitialized) return;

    if (countdown <= 0) {
      navigate(homePath, { replace: true });
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown, autoRedirectEnabled, isInitialized, homePath, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12 text-center">
      <div className="mx-auto max-w-md space-y-6">
        <div className="relative inline-flex">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 shadow-xs">
            <Compass className="h-10 w-10 animate-pulse" />
          </div>
          <span className="absolute -right-3 -top-2 rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-xs">
            404
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight sm:text-4xl">
            Không tìm thấy trang
          </h1>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            Đường dẫn <code className="font-mono text-xs bg-neutral-200/80 px-1.5 py-0.5 rounded text-neutral-700">{location.pathname}</code> không tồn tại hoặc đã được cập nhật.
          </p>
        </div>

        {autoRedirectEnabled && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-blue-50 border border-blue-100 p-2.5 text-xs text-blue-800">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
            <span>Tự động chuyển về trang chính sau <strong>{countdown}s</strong>...</span>
            <button
              onClick={() => setAutoRedirectEnabled(false)}
              className="ml-1 text-neutral-400 hover:text-neutral-700 inline-flex items-center gap-0.5 underline cursor-pointer"
              title="Dừng tự động chuyển hướng"
            >
              <XCircle className="h-3.5 w-3.5" /> Dừng
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Button
            variant="primary"
            onClick={() => navigate(homePath, { replace: true })}
            leftIcon={<Home className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            {homeLabel}
          </Button>

          <Button
            variant="outline"
            onClick={() => window.history.back()}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Quay lại trang trước
          </Button>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
