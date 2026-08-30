import { useNavigate, useLocation } from "react-router-dom";
import { LogOut, User as UserIcon, Menu, Bell } from "lucide-react";
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

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const getPageTitle = () => {
    if (location.pathname.startsWith("/teacher/create-quiz")) return "Soạn đề thi mới";
    if (location.pathname.startsWith("/teacher/quizzes")) return "Quản lý danh sách đề";
    if (location.pathname.startsWith("/teacher")) return "Bảng điều khiển Giáo viên";
    if (location.pathname.startsWith("/design-system")) return "Design System UI Primitives";
    if (location.pathname.startsWith("/student")) return "Cổng làm bài Học sinh";
    return "Tổng quan";
  };

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-neutral-200/80 bg-white/90 backdrop-blur-md">
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
            <p className="mt-1 hidden text-xs text-neutral-500 sm:block">
              Hệ thống thi trắc nghiệm trực tuyến thế hệ mới
            </p>
          </div>
        </div>

        {/* Right: User status, notifications & Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            aria-label="Thông báo"
            className="relative rounded-full p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition cursor-pointer"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-600" />
          </button>

          <div className="h-6 w-px bg-neutral-200" />

          {/* User profile info */}
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="flex items-center gap-2 justify-end">
                <p className="text-xs font-semibold text-neutral-900">
                  {user?.fullName || user?.email || "Người dùng"}
                </p>
                <Badge
                  size="sm"
                  variant={user?.role === "teacher" ? "primary" : "success"}
                >
                  {user?.role === "teacher" ? "Giáo viên" : "Học sinh"}
                </Badge>
              </div>
              <p className="text-[11px] text-neutral-500">{user?.email}</p>
            </div>

            {/* Avatar */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-tr from-indigo-600 to-violet-500 text-sm font-bold text-white shadow-xs">
              {user?.fullName?.charAt(0).toUpperCase() || (
                <UserIcon className="h-4 w-4" />
              )}
            </div>

            {/* Logout button */}
            <button
              type="button"
              onClick={handleLogout}
              title="Đăng xuất"
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition cursor-pointer"
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
