import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Bell,
  Bug,
  Check,
  CheckCheck,
  FileCheck2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { formatVietnamDateTime, type InAppNotification } from "@qizzone/domain";
import { useNotificationStore } from "@/store/notificationStore";
import { useAuthStore } from "@/store/authStore";
import { getRoleHomeRoute } from "@/routes/navigation";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/auth";

export interface NotificationBellProps {
  className?: string;
}

function canRoleAccessRoute(role: UserRole, route: string): boolean {
  if (route.startsWith("/admin")) return role === "admin";
  if (route.startsWith("/teacher")) return role === "teacher" || role === "admin";
  if (route.startsWith("/student")) {
    if (role === "student") return true;
    return route.startsWith("/student/quiz/") || route.startsWith("/student/result/");
  }
  return true;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "teacher_approval":
      return {
        Icon: ShieldCheck,
        badgeClass: "theme-status-success",
      };
    case "role_changed":
      return {
        Icon: ArrowLeftRight,
        badgeClass: "theme-status-info",
      };
    case "account_status":
      return {
        Icon: ShieldAlert,
        badgeClass: "theme-status-danger",
      };
    case "classroom_joined":
      return {
        Icon: Users,
        badgeClass: "theme-status-accent",
      };
    case "quiz_assigned":
      return {
        Icon: FileCheck2,
        badgeClass: "theme-status-info",
      };
    case "bug_report_created":
    case "bug_report_updated":
      return {
        Icon: Bug,
        badgeClass: "theme-status-warning",
      };
    default:
      return {
        Icon: Bell,
        badgeClass: "theme-status-info",
      };
  }
}

export function NotificationBell({ className }: NotificationBellProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const user = useAuthStore((state) => state.user);
  const refreshProfile = useAuthStore((state) => state.refreshProfile);
  const switchRole = useAuthStore((state) => state.switchRole);

  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const isLoading = useNotificationStore((state) => state.isLoading);
  const loadNotifications = useNotificationStore((state) => state.load);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);

  const [isOpen, setIsOpen] = useState(false);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && notifications.length === 0 && !isLoading) {
      void loadNotifications().catch(() => undefined);
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      await markAllRead();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đánh dấu tất cả là đã đọc.");
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleMarkSingleRead = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    try {
      await markRead([id]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể đánh dấu thông báo đã đọc.");
    }
  };

  const handleNotificationClick = async (item: InAppNotification) => {
    if (navigatingId) return;
    setNavigatingId(item.id);
    if (!item.isRead) {
      void markRead([item.id]).catch(() => undefined);
    }
    setIsOpen(false);

    const fallbackRoute = user ? getRoleHomeRoute(user.role) : "/";
    const targetRoute =
      item.targetRoute && item.targetRoute.startsWith("/") && !item.targetRoute.startsWith("//")
        ? item.targetRoute
        : fallbackRoute;

    try {
      if (item.type === "teacher_approval") {
        const freshUser = await refreshProfile();
        if (targetRoute.startsWith("/teacher")) {
          if (freshUser && freshUser.role !== "teacher" && freshUser.role !== "admin") {
            if (freshUser.teacherRequestStatus === "approved") {
              await switchRole("teacher");
            } else {
              toast.warning("Quyền giáo viên hiện chưa được kích hoạt.");
              return;
            }
          }
          navigate(targetRoute);
          return;
        }
        navigate(targetRoute);
        return;
      }

      if (item.type === "role_changed") {
        const freshUser = await refreshProfile();
        if (!freshUser) {
          navigate("/login");
          return;
        }
        if (
          freshUser.role === "teacher" &&
          targetRoute.startsWith("/student") &&
          !targetRoute.startsWith("/student/quiz/") &&
          !targetRoute.startsWith("/student/result/") &&
          freshUser.baseRole === "student" &&
          freshUser.teacherRequestStatus === "approved"
        ) {
          await switchRole("student");
          navigate(targetRoute);
          return;
        }
        if (
          freshUser.role === "student" &&
          targetRoute.startsWith("/teacher") &&
          freshUser.teacherRequestStatus === "approved"
        ) {
          await switchRole("teacher");
          navigate(targetRoute);
          return;
        }
        navigate(canRoleAccessRoute(freshUser.role, targetRoute) ? targetRoute : getRoleHomeRoute(freshUser.role));
        return;
      }

      if (
        (item.type === "bug_report_updated" || item.type === "bug_report_created") &&
        targetRoute.startsWith("/teacher/") &&
        user?.role === "student"
      ) {
        const freshUser = await refreshProfile();
        if (!freshUser) {
          navigate("/login");
          return;
        }
        if (freshUser.role === "teacher" || freshUser.role === "admin") {
          navigate(targetRoute);
          return;
        }
        if (freshUser.teacherRequestStatus === "approved") {
          await switchRole("teacher");
          navigate(targetRoute);
          return;
        }
        navigate(targetRoute.replace(/^\/teacher\/bug-reports/, "/student/bug-reports"));
        return;
      }

      if (
        (item.type === "bug_report_updated" || item.type === "bug_report_created") &&
        targetRoute.startsWith("/student/bug-reports") &&
        user?.role !== "student"
      ) {
        const freshUser = await refreshProfile();
        if (!freshUser) {
          navigate("/login");
          return;
        }
        if (freshUser.role === "student") {
          navigate(targetRoute);
          return;
        }
        if (
          freshUser.role === "teacher" &&
          freshUser.baseRole === "student" &&
          freshUser.teacherRequestStatus === "approved"
        ) {
          await switchRole("student");
          navigate(targetRoute);
          return;
        }
        if (freshUser.role === "admin") {
          navigate(targetRoute.replace(/^\/student\/bug-reports/, "/admin/bug-reports"));
          return;
        }
        navigate(targetRoute.replace(/^\/student\/bug-reports/, "/teacher/bug-reports"));
        return;
      }

      if (
        targetRoute.startsWith("/student") &&
        !canRoleAccessRoute(user?.role ?? "student", targetRoute)
      ) {
        const freshUser = await refreshProfile();
        if (!freshUser) {
          navigate("/login");
          return;
        }
        if (canRoleAccessRoute(freshUser.role, targetRoute)) {
          navigate(targetRoute);
          return;
        }
        if (
          freshUser.role === "teacher" &&
          freshUser.baseRole === "student" &&
          freshUser.teacherRequestStatus === "approved"
        ) {
          await switchRole("student");
          navigate(targetRoute);
          return;
        }
        toast.warning("Thông báo này thuộc vai trò học sinh.");
        navigate(getRoleHomeRoute(freshUser.role));
        return;
      }

      navigate(targetRoute);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể mở đích đến của thông báo.");
    } finally {
      setNavigatingId(null);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `Thông báo (${unreadCount} chưa đọc)` : "Thông báo"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="relative flex h-11 w-11 items-center justify-center rounded-full theme-text-secondary transition-colors duration-150 theme-hover-surface theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--danger-action)] px-1 text-[10px] font-bold leading-none text-[var(--danger-action-foreground)] ring-2 ring-[var(--surface)]"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <span className="sr-only" aria-live="polite">
        {unreadCount > 0 ? `Bạn có ${unreadCount} thông báo chưa đọc` : ""}
      </span>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Danh sách thông báo"
          className="fixed inset-x-4 top-18 z-40 flex max-h-[min(75dvh,30rem)] flex-col overflow-hidden rounded-xl border theme-popover sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b theme-border px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-sm font-semibold theme-text-primary">Thông báo</h3>
              {unreadCount > 0 && (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold theme-status-info border">
                  {unreadCount} mới
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                disabled={isMarkingAll}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold theme-link transition-colors theme-hover-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Đọc tất cả</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {isLoading && notifications.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm theme-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Đang tải thông báo...</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-1.5">
                <Bell className="mx-auto h-8 w-8 theme-text-muted opacity-60" aria-hidden="true" />
                <p className="text-sm font-medium theme-text-primary">Chưa có thông báo nào</p>
                <p className="text-xs theme-text-muted">
                  Các cập nhật về bài tập, phê duyệt và báo lỗi sẽ hiển thị tại đây.
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const { Icon, badgeClass } = getNotificationIcon(item.type);
                const formattedTime = formatVietnamDateTime(item.createdAt);
                const isBusy = navigatingId === item.id;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-2.5 p-3 transition-colors duration-150",
                      item.isRead ? "theme-hover-surface" : "theme-notification-unread"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void handleNotificationClick(item)}
                      disabled={Boolean(navigatingId)}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                          badgeClass
                        )}
                      >
                        {isBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          {!item.isRead && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full theme-dot-info"
                              aria-hidden="true"
                            />
                          )}
                          <p className="truncate text-sm font-semibold theme-text-primary">
                            {item.title}
                          </p>
                        </div>
                        <p className="line-clamp-2 text-xs leading-5 theme-text-secondary">
                          {item.body}
                        </p>
                        <p className="text-[11px] theme-text-muted" title={item.createdAt}>
                          {formattedTime}
                        </p>
                      </div>
                    </button>

                    {!item.isRead && (
                      <button
                        type="button"
                        onClick={(e) => void handleMarkSingleRead(e, item.id)}
                        aria-label={`Đánh dấu đã đọc: ${item.title}`}
                        title="Đánh dấu đã đọc"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg theme-text-muted transition-colors theme-hover-surface theme-hover-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
