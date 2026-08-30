import { useNavigate, Link } from "react-router-dom";
import { ShieldAlert, LogOut, ArrowRight, Home } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";

export function Unauthorized() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogoutAndRelogin = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 py-12 text-center">
      <div className="mx-auto max-w-md space-y-6">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-100 text-rose-600 shadow-lg shadow-rose-100">
          <ShieldAlert className="h-10 w-10" />
        </div>

        <div className="space-y-2">
          <span className="text-sm font-semibold tracking-wider text-rose-600 uppercase">
            Mã lỗi: 403 Forbidden
          </span>
          <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight sm:text-4xl">
            Không có quyền truy cập
          </h1>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            {user ? (
              <>
                Bạn đang đăng nhập với vai trò{" "}
                <strong>{user.role === "teacher" ? "Giáo viên" : "Học sinh"}</strong> (
                {user.email}), không có quyền truy cập vào đường dẫn này.
              </>
            ) : (
              "Tài khoản của bạn không có vai trò phù hợp để truy cập vào phân vùng này."
            )}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          {user ? (
            <Button
              variant="primary"
              onClick={() =>
                navigate(user.role === "teacher" ? "/teacher" : "/student", {
                  replace: true,
                })
              }
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className="w-full sm:w-auto"
            >
              Về trang {user.role === "teacher" ? "Giáo viên" : "Học sinh"}
            </Button>
          ) : (
            <Link to="/login" className="w-full sm:w-auto">
              <Button variant="primary" className="w-full sm:w-auto">
                Đăng nhập
              </Button>
            </Link>
          )}

          <Button
            variant="outline"
            onClick={handleLogoutAndRelogin}
            leftIcon={<LogOut className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            Đổi tài khoản khác
          </Button>

          <Link to="/" className="w-full sm:w-auto">
            <Button
              variant="ghost"
              leftIcon={<Home className="h-4 w-4" />}
              className="w-full sm:w-auto"
            >
              Trang chủ
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Unauthorized;