import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, GraduationCap, Link2, Loader2 } from "lucide-react";
import type { Classroom } from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";
import { classroomService } from "@/services/classroomService";
import { useAuthStore } from "@/store/authStore";

type JoinState =
  | { status: "checking" }
  | { status: "ready"; existingClassroom?: Classroom }
  | { status: "joining" }
  | { status: "success"; classroom: Classroom }
  | { status: "error"; message: string };

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Không thể tham gia lớp học.";
  if (/không tìm thấy lớp/i.test(message)) return "Mã lớp trong liên kết không tồn tại hoặc đã hết hạn.";
  if (/tạm tắt lời mời/i.test(message)) return "Giáo viên đã tạm tắt lời mời tham gia lớp học này.";
  if (/đã được lưu trữ/i.test(message)) return "Lớp học này đã được lưu trữ.";
  return message;
}

export function JoinClassByLink() {
  const { code: routeCode } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isAuthenticated, isInitialized } = useAuthStore();
  const [joinState, setJoinState] = useState<JoinState>({ status: "checking" });
  const code = (routeCode || searchParams.get("code") || "").trim().toUpperCase();
  const inviteUrl = typeof window !== "undefined" && code ? `${window.location.origin}/class/join/${code}` : "";

  useEffect(() => {
    if (!isInitialized || !isAuthenticated || !user || user.role !== "student" || !code) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const myClassrooms = await classroomService.listMyClassrooms();
        if (cancelled) return;
        const existing = myClassrooms.find((item) => item.inviteCode.toUpperCase() === code);
        setJoinState({ status: "ready", existingClassroom: existing });
      } catch {
        if (!cancelled) setJoinState({ status: "ready" });
      }
    })();
    return () => { cancelled = true; };
  }, [code, isAuthenticated, isInitialized, user]);

  const handleJoinByLink = async () => {
    if (!code) return;
    setJoinState({ status: "joining" });
    try {
      const classroom = await classroomService.joinByCode(code, "link");
      toast.success("Đã tham gia lớp thành công.");
      setJoinState({ status: "success", classroom });
    } catch (error) {
      const message = friendlyError(error);
      if (/đã tham gia|đã là thành viên|đã ở trong lớp/i.test(message)) {
        try {
          const existing = (await classroomService.listMyClassrooms()).find((item) => item.inviteCode.toUpperCase() === code);
          if (existing) {
            setJoinState({ status: "success", classroom: existing });
            return;
          }
        } catch {
          // Fall through to error display
        }
      }
      setJoinState({ status: "error", message });
    }
  };

  const redirectTarget = `${location.pathname}${location.search}`;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10">
      <Card className="w-full overflow-hidden">
        <CardContent className="space-y-5 p-6 text-center sm:p-8">
          {!code ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                <AlertCircle className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Liên kết lớp không hợp lệ</h1>
              <p className="text-sm theme-text-secondary">Liên kết không có mã lớp. Mở lại đường dẫn do giáo viên gửi.</p>
              <Button variant="outline" onClick={() => navigate("/student/classes")}>Quay lại</Button>
            </>
          ) : !isInitialized ? (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-700" aria-hidden="true" />
              <h1 className="text-xl font-bold theme-text-primary">Đang kiểm tra đăng nhập…</h1>
              <p className="text-sm theme-text-secondary">Mã lớp: <span className="font-mono font-bold">{code}</span></p>
            </>
          ) : !isAuthenticated || !user ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
                <Link2 className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Tham gia lớp học qua liên kết</h1>
              <div className="rounded-xl border theme-border theme-surface-muted p-4 text-left text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide theme-text-muted">Thông tin link lớp</p>
                <p className="mt-1 font-mono font-bold text-blue-800">Mã mời: {code}</p>
                {inviteUrl && <p className="mt-1 truncate text-xs theme-text-secondary">{inviteUrl}</p>}
              </div>
              <p className="text-sm theme-text-secondary">Đăng nhập bằng tài khoản học sinh để xác nhận tham gia lớp học này.</p>
              <Link
                to={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Đăng nhập để tham gia
              </Link>
            </>
          ) : user.role !== "student" ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                <AlertCircle className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Không thể tham gia lớp</h1>
              <p className="text-sm theme-text-secondary">Chỉ tài khoản ở chế độ học sinh mới có thể tham gia lớp học bằng mã mời.</p>
              <Button variant="outline" onClick={() => navigate("/teacher")}>Quay lại</Button>
            </>
          ) : joinState.status === "checking" ? (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-700" aria-hidden="true" />
              <h1 className="text-xl font-bold theme-text-primary">Đang tải thông tin link lớp…</h1>
              <p className="text-sm theme-text-secondary">Mã mời: <span className="font-mono font-bold">{code}</span></p>
            </>
          ) : joinState.status === "ready" && joinState.existingClassroom ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Bạn đã là thành viên của lớp</h1>
              <div className="rounded-xl border theme-border theme-surface-muted p-4 text-left text-sm">
                <p className="font-semibold theme-text-primary">{joinState.existingClassroom.name}</p>
                <p className="mt-1 text-xs theme-text-secondary">
                  {[joinState.existingClassroom.subject, joinState.existingClassroom.teacherName].filter(Boolean).join(" · ") || `Mã lớp: ${code}`}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <Button variant="outline" onClick={() => navigate("/student/classes")} leftIcon={<ArrowLeft className="h-4 w-4" />}>
                  Danh sách lớp
                </Button>
                <Button
                  variant="primary"
                  aria-label="Đi đến lớp học - Tham gia lớp"
                  onClick={() => navigate(`/student/classes/${joinState.existingClassroom!.id}`)}
                >
                  Đi đến lớp học
                </Button>
              </div>
            </>
          ) : joinState.status === "ready" || joinState.status === "joining" ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
                <GraduationCap className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Lời mời tham gia lớp học</h1>
              <div className="rounded-xl border theme-border theme-surface-muted p-4 text-left text-sm space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide theme-text-muted">
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Thông tin link lớp</span>
                </div>
                <p className="font-semibold theme-text-primary">
                  Mã lớp: <span className="font-mono text-blue-800">{code}</span>
                </p>
                {inviteUrl && <p className="break-all text-xs theme-text-secondary">{inviteUrl}</p>}
              </div>
              <p className="text-sm theme-text-secondary">Nhấn nút bên dưới để tham gia vào lớp học của giáo viên.</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button variant="outline" onClick={() => navigate("/student/classes")} leftIcon={<ArrowLeft className="h-4 w-4" />}>
                  Quay lại
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void handleJoinByLink()}
                  isLoading={joinState.status === "joining"}
                >
                  Tham gia lớp
                </Button>
              </div>
            </>
          ) : joinState.status === "error" ? (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                <AlertCircle className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Không thể tham gia lớp</h1>
              <p role="alert" className="text-sm theme-text-secondary">{joinState.message}</p>
              <Button variant="outline" onClick={() => navigate("/student/classes")} leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Quay lại
              </Button>
            </>
          ) : (
            <>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              </div>
              <h1 className="text-xl font-bold theme-text-primary">Bạn đã vào lớp</h1>
              <p className="text-sm theme-text-secondary">
                Bạn đã tham gia <strong className="theme-text-primary">{joinState.classroom.name}</strong>.
              </p>
              <Button
                variant="primary"
                aria-label="Đi đến lớp học - Tham gia lớp"
                onClick={() => navigate(`/student/classes/${joinState.classroom.id}`)}
              >
                Đi đến lớp học
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default JoinClassByLink;
