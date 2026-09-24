import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeftRight, CheckCircle2, ChevronDown, Clock3, GraduationCap, LogOut, User as UserIcon, Menu, ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";

interface NavbarProps {
  onToggleMobileSidebar?: () => void;
}

const TEACHER_BLOCKED_MESSAGE = "Bạn không thể đổi tài khoản giáo viên ở tài khoản này. Vui lòng liên hệ hỗ trợ!";

function roleLabel(role?: string) {
  return role === "admin" ? "Quản trị" : role === "teacher" ? "Giáo viên" : "Học sinh";
}

export function Navbar({ onToggleMobileSidebar }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const requestTeacherAccess = useAuthStore((state) => state.requestTeacherAccess);
  const switchRole = useAuthStore((state) => state.switchRole);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  useEffect(() => {
    if (!isProfileOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setIsProfileOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isProfileOpen]);

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  const handleRequestTeacherAccess = async () => {
    setIsActionLoading(true);
    try {
      const updated = await requestTeacherAccess();
      setIsRequestModalOpen(false);
      setIsProfileOpen(false);
      if (updated.teacherRequestStatus === "pending") {
        toast.info("Yêu cầu đã được gửi tới quản trị viên. Bạn vẫn có thể sử dụng tài khoản học sinh trong lúc chờ duyệt.", "Đã gửi yêu cầu");
      } else if (updated.teacherRequestStatus === "approved") {
        toast.success("Tài khoản của bạn đã có quyền giáo viên. Bạn có thể chuyển đổi bất cứ lúc nào.", "Đã được duyệt");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể gửi yêu cầu cấp tài khoản giáo viên.";
      toast.error(message, "Không thể gửi yêu cầu");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleSwitchRole = async (role: "student" | "teacher") => {
    setIsActionLoading(true);
    try {
      await switchRole(role);
      setIsProfileOpen(false);
      const destination = role === "teacher" ? "/teacher" : "/student";
      navigate(destination, { replace: true });
      toast.success(`Đã chuyển sang tài khoản ${role === "teacher" ? "giáo viên" : "học sinh"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể chuyển đổi tài khoản.";
      toast.error(message, "Không thể chuyển đổi");
    } finally {
      setIsActionLoading(false);
    }
  };

  const getPageTitle = () => {
    if (location.pathname.startsWith("/teacher/create-quiz")) return "Soạn đề thi mới";
    if (location.pathname.startsWith("/teacher/quizzes")) return "Quản lý danh sách đề";
    if (location.pathname.startsWith("/teacher")) return "Bảng điều khiển Giáo viên";
    if (location.pathname.startsWith("/admin/teacher-approvals")) return "Duyệt tài khoản Giáo viên";
    if (location.pathname.startsWith("/student")) return "Cổng làm bài Học sinh";
    return "Tổng quan";
  };

  const teacherRequestStatus = user?.teacherRequestStatus || "none";
  const canSwitchToTeacher = user?.role === "student" && user.baseRole === "student" && teacherRequestStatus === "approved";
  const canSwitchToStudent = user?.role === "teacher" && user.baseRole === "student" && teacherRequestStatus === "approved";

  return (
    <>
      <header className="sticky top-0 z-30 h-16 border-b border-neutral-200 bg-white">
        <div className="flex h-full items-center justify-between px-4 sm:px-6 lg:px-8">
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
              <h2 className="text-sm font-semibold text-neutral-900 leading-none">{getPageTitle()}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <div className="flex items-center gap-2 justify-end">
                  <p className="text-sm font-medium text-neutral-900">{user?.fullName || user?.email || "Người dùng"}</p>
                  <Badge size="sm" variant={user?.role !== "student" ? "primary" : "success"}>{roleLabel(user?.role)}</Badge>
                </div>
                <p className="mt-0.5 max-w-48 truncate text-[11px] text-neutral-500">{user?.email}</p>
              </div>

              <div className="relative" ref={profileMenuRef}>
                <button
                  type="button"
                  aria-label="Mở tài khoản"
                  aria-expanded={isProfileOpen}
                  onClick={() => setIsProfileOpen((open) => !open)}
                  className="flex h-9 items-center gap-1.5 rounded-full p-0.5 text-blue-700 transition hover:bg-blue-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="Ảnh đại diện" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                      {user?.fullName?.charAt(0).toUpperCase() || <UserIcon className="h-4 w-4" />}
                    </span>
                  )}
                  <ChevronDown className="hidden h-3.5 w-3.5 sm:block" />
                </button>

                {isProfileOpen && (
                  <div className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                    <div className="border-b border-neutral-100 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-neutral-900">{user?.fullName || "Người dùng"}</p>
                      <p className="truncate text-xs text-neutral-500">{user?.email}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge size="sm" variant={user?.role !== "student" ? "primary" : "success"}>{roleLabel(user?.role)}</Badge>
                        {user?.baseRole === "student" && <span className="text-[11px] text-neutral-500">Tài khoản gốc: học sinh</span>}
                      </div>
                    </div>

                    {user?.role === "student" && user.baseRole === "student" && (
                      <div className="space-y-3 px-4 py-3">
                        {user.teacherRequestBlocked ? (
                          <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{TEACHER_BLOCKED_MESSAGE}</span>
                          </div>
                        ) : teacherRequestStatus === "pending" ? (
                          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>Yêu cầu cấp tài khoản giáo viên đang chờ quản trị viên duyệt.</span>
                          </div>
                        ) : canSwitchToTeacher ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            isLoading={isActionLoading}
                            onClick={() => void handleSwitchRole("teacher")}
                            leftIcon={<ArrowLeftRight className="h-4 w-4" />}
                          >
                            Chuyển sang tài khoản giáo viên
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => { setIsProfileOpen(false); setIsRequestModalOpen(true); }}
                            leftIcon={<GraduationCap className="h-4 w-4" />}
                          >
                            Gửi yêu cầu tài khoản giáo viên
                          </Button>
                        )}
                        {teacherRequestStatus === "rejected" && !user.teacherRequestBlocked && (
                          <p className="text-[11px] leading-4 text-neutral-500">Yêu cầu trước đã bị từ chối. Bạn có thể gửi lại yêu cầu.</p>
                        )}
                      </div>
                    )}

                    {canSwitchToStudent && (
                      <div className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          isLoading={isActionLoading}
                          onClick={() => void handleSwitchRole("student")}
                          leftIcon={<ArrowLeftRight className="h-4 w-4" />}
                        >
                          Chuyển sang tài khoản học sinh
                        </Button>
                      </div>
                    )}

                    <div className="border-t border-neutral-100 p-2">
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-700 transition hover:bg-rose-50"
                      >
                        <LogOut className="h-4 w-4" />
                        Đăng xuất
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <Modal
        isOpen={isRequestModalOpen}
        onClose={() => !isActionLoading && setIsRequestModalOpen(false)}
        title="Gửi yêu cầu cấp tài khoản giáo viên"
        description="Yêu cầu sẽ được gửi tới quản trị viên để xét duyệt."
        footer={(
          <>
            <Button variant="ghost" onClick={() => setIsRequestModalOpen(false)} disabled={isActionLoading}>Để sau</Button>
            <Button isLoading={isActionLoading} onClick={() => void handleRequestTeacherAccess()} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
              Xác nhận gửi yêu cầu
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-neutral-600">
          Bạn vẫn đăng nhập và làm bài với tài khoản học sinh trong thời gian chờ duyệt. Chỉ sau khi admin chấp thuận, bạn mới có thể chuyển sang màn hình giáo viên.
        </p>
      </Modal>
    </>
  );
}

export default Navbar;
