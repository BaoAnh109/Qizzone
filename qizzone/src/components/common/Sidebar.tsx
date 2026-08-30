import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  PlusCircle,
  FileQuestion,
  Palette,
  GraduationCap,
  Sparkles,
  X,
  BookOpen,
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
    {
      label: "Design System (UI)",
      path: "/design-system",
      icon: Palette,
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
      label: "Design System (UI)",
      path: "/design-system",
      icon: Palette,
    },
  ];

  const menuItems =
    user?.role === "teacher" ? teacherMenuItems : studentMenuItems;

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white">
      {/* Brand Logo Header */}
      <div className="flex h-16 items-center justify-between border-b border-neutral-200/80 px-6">
        <NavLink to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <span className="text-lg font-black tracking-tight text-neutral-950">
              Qiz<span className="text-indigo-600">zone</span>
            </span>
            <span className="ml-1.5 inline-block rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
              PRO
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
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <p className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
          {user?.role === "teacher" ? "Giáo viên" : "Học sinh"} Navigation
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
                    "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150",
                    isActive
                      ? "bg-indigo-600 text-white shadow-xs shadow-indigo-200"
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

      {/* Footer Banner */}
      <div className="border-t border-neutral-200/80 p-4">
        <div className="rounded-xl bg-linear-to-br from-indigo-50 to-violet-50 p-3.5 border border-indigo-100/70">
          <div className="flex items-center gap-2 text-indigo-700 font-semibold text-xs mb-1">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Qizzone Engine v1.0</span>
          </div>
          <p className="text-[11px] text-neutral-500 leading-normal">
            Hỗ trợ công thức Toán LaTeX, Chấm điểm tức thì & Chống mất bài.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-neutral-200/80 bg-white lg:block">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-neutral-950/50 backdrop-blur-xs transition-opacity animate-in fade-in"
            onClick={onCloseMobile}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <div className="fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-white shadow-2xl transition-transform transform animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

export default Sidebar;
