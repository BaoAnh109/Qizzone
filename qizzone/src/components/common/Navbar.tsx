import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, User as UserIcon, Menu } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/Badge";

interface NavbarProps {
  onToggleMobileSidebar?: () => void;
}

export function Navbar({ onToggleMobileSidebar }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  const getPageTitle = () => {
    if (location.pathname.startsWith("/teacher/create-quiz")) return "Soạn đề thi mới";
    if (location.pathname.startsWith("/teacher/quizzes")) return "Quản lý danh sách đề";
    if (location.pathname.startsWith("/teacher")) return "Bảng điều khiển Giáo viên";
    if (location.pathname.startsWith("/admin/teacher-approvals")) return "Duyệt tài khoản Giáo viên";
    if (location.pathname.startsWith("/student")) return "Cổng làm bài Học sinh";
    return "Tổng quan";
  };

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-neutral-200 bg-white">
      <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: Mobile hamburger & breadcrumbs */}
        <div className="flex items-center gap-3">
          {onToggleMobileSidebar && (
            <button
              type="button"
              onClick={onToggleMobileSidebar}
              aria-label="Mở menu"
              className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 lg:hidden cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}

          <div>
            <h2 className="text-sm font-semibold text-neutral-900 leading-none">
              {getPageTitle()}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* User profile info */}
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="flex items-center gap-2 justify-end">
                <p className="text-sm font-medium text-neutral-900">
                  {user?.fullName || user?.email || "Người dùng"}
                </p>
                <Badge
                  size="sm"
                  variant={user?.role !== "student" ? "primary" : "success"}
                >
                  {user?.role === "admin" ? "Quản trị" : user?.role === "teacher" ? "Giáo viên" : "Học sinh"}
                </Badge>
              </div>
              <p className="mt-0.5 max-w-48 truncate text-[11px] text-neutral-500">{user?.email}</p>
            </div>

            {/* Avatar */}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
              {user?.fullName?.charAt(0).toUpperCase() || (
                <UserIcon className="h-4 w-4" />
              )}
            </div>

            {/* Logout button */}
            <button
              type="button"
              onClick={() => void handleLogout()}
              title="Đăng xuất"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
