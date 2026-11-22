import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  PlusCircle,
  FileQuestion,
  GraduationCap,
  X,
  BookOpen,
  History,
  ShieldCheck,
  Users,
  School,
  Bug,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";

interface SidebarProps {
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ isOpenMobile, onCloseMobile }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpenMobile || !onCloseMobile) return undefined;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mobileDrawerRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement && previousActiveElement.isConnected) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [isOpenMobile, onCloseMobile]);

  const teacherCoreMenuItems = [
    {
      label: "Bảng điều khiển",
      path: "/teacher",
      icon: LayoutDashboard,
      end: true,
    },
    {
      label: "Lớp học",
      path: "/teacher/classes",
      icon: School,
    },
    {
      label: "Tạo đề thi mới",
      path: "/teacher/create-quiz",
      icon: PlusCircle,
    },
    {
      label: "Danh sách đề thi",
      path: "/teacher/quizzes",
      icon: FileQuestion,
    },
  ];

  const teacherMenuItems = [
    ...teacherCoreMenuItems,
    {
      label: "Báo lỗi",
      path: "/teacher/bug-reports",
      icon: Bug,
    },
  ];

  const studentMenuItems = [
    {
      label: "Vào phòng thi",
      path: "/student",
      icon: BookOpen,
      end: true,
    },
    {
      label: "Lớp học của tôi",
      path: "/student/classes",
      icon: School,
    },
    {
      label: "Lịch sử luyện tập",
      path: "/student/practice",
      icon: History,
      end: true,
    },
    {
      label: "Báo lỗi",
      path: "/student/bug-reports",
      icon: Bug,
    },
  ];

  const adminMenuItems = [
    {
      label: "Quản lý tài khoản",
      path: "/admin/accounts",
      icon: Users,
    },
    {
      label: "Duyệt giáo viên",
      path: "/admin/teacher-approvals",
      icon: ShieldCheck,
    },
    {
      label: "Báo lỗi hệ thống",
      path: "/admin/bug-reports",
      icon: Bug,
    },
    ...teacherCoreMenuItems,
  ];

  const menuItems = user?.role === "admin"
    ? adminMenuItems
    : user?.role === "teacher"
      ? teacherMenuItems
      : studentMenuItems;

  const sidebarContent = (
    <div className="theme-surface flex h-full flex-col">
      {/* Brand Logo Header */}
      <div className="flex h-16 items-center justify-between border-b theme-border px-5">
        <NavLink to="/" className="flex items-center gap-2.5" onClick={onCloseMobile}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
            <GraduationCap className="h-[18px] w-[18px]" aria-hidden="true" />
          </div>
          <div className="leading-tight">
              <span className="font-display text-lg font-bold tracking-tight theme-text-primary">
              Qiz<span className="text-primary">zone</span>
            </span>
          </div>
        </NavLink>

        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Đóng menu"
            className="flex h-11 w-11 items-center justify-center rounded-lg theme-text-muted theme-hover-surface theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary lg:hidden cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider theme-text-muted">
          {user?.role === "admin" ? "Quản trị" : user?.role === "teacher" ? "Giáo viên" : "Học sinh"}
        </p>

        <nav className="space-y-1" aria-label="Điều hướng chính">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
                    isActive
                      ? "theme-nav-active"
                      : "theme-text-secondary theme-hover-surface theme-hover-text-primary"
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="border-t theme-border px-5 py-4">
        <p className="text-xs leading-5 theme-text-muted">Qizzone · Quản lý thi trực tuyến</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r theme-border theme-surface lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-neutral-950/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu điều hướng"
            tabIndex={-1}
            className="fixed inset-y-0 left-0 w-72 max-w-[85vw] theme-surface shadow-xl focus:outline-hidden"
          >
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
