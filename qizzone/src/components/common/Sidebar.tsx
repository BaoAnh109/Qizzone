import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  PlusCircle,
  FileQuestion,
  GraduationCap,
  X,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { cn } from "@/lib/utils";

interface SidebarProps {
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ isOpenMobile, onCloseMobile }: SidebarProps) {
  const user = useAuthStore((state) => state.user);

  const teacherMenuItems = [
    {
      label: "Bảng điều khiển",
      path: "/teacher",
      icon: LayoutDashboard,
      end: true,
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

  const studentMenuItems = [
    {
      label: "Vào phòng thi",
      path: "/student",
      icon: BookOpen,
      end: true,
    },
  ];

  const adminMenuItems = [
    {
      label: "Duyệt giáo viên",
      path: "/admin/teacher-approvals",
      icon: ShieldCheck,
    },
    ...teacherMenuItems,
  ];

  const menuItems = user?.role === "admin"
    ? adminMenuItems
    : user?.role === "teacher"
      ? teacherMenuItems
      : studentMenuItems;

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white">
      {/* Brand Logo Header */}
      <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-5">
        <NavLink to="/" className="flex items-center gap-2.5" onClick={onCloseMobile}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <GraduationCap className="h-[18px] w-[18px]" />
          </div>
          <div className="leading-tight">
            <span className="text-lg font-bold tracking-tight text-neutral-950">
              Qiz<span className="text-blue-600">zone</span>
            </span>
          </div>
        </NavLink>

        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 lg:hidden cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          {user?.role === "admin" ? "Quản trị" : user?.role === "teacher" ? "Giáo viên" : "Học sinh"}
        </p>

        <nav className="space-y-1">
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
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-neutral-200 px-5 py-4">
        <p className="text-xs leading-5 text-neutral-500">Qizzone · Quản lý thi trực tuyến</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 bg-white lg:block">
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
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
