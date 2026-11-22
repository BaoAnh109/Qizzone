import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import type { Classroom } from "@qizzone/domain";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useAuthStore } from "@/store/authStore";
import { classroomService } from "@/services/classroomService";

type JoinState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; classroom: Classroom }
  | { status: "error"; message: string };

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Không thể tham gia lớp học. Vui lòng thử lại.";
  if (/không tìm thấy lớp/i.test(message)) return "Không tìm thấy lớp học với mã mời này.";
  if (/tạm tắt lời mời/i.test(message)) return "Giáo viên đã tạm tắt lời mời tham gia lớp học này.";
  if (/đã được lưu trữ/i.test(message)) return "Lớp học này đã được lưu trữ.";
  return message;
}

export function JoinClassByLink() {
  const { code: routeCode } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuthStore();
  const [joinState, setJoinState] = useState<JoinState>({ status: "idle" });
  const code = (routeCode || searchParams.get("code") || "").trim().toUpperCase();

  useEffect(() => {
    if (!isInitialized || !isAuthenticated || !user || user.role !== "student" || !code) return undefined;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setJoinState({ status: "loading" });
      try {
        const classroom = await classroomService.joinByCode(code, "link");
        if (!cancelled) setJoinState({ status: "success", classroom });
      } catch (error) {
        const message = friendlyError(error);
        if (/đã tham gia|đã là thành viên|đã ở trong lớp/i.test(message)) {
          try {
            const existing = (await classroomService.listMyClassrooms()).find((item) => item.inviteCode.toUpperCase() === code);
            if (existing) {
              if (!cancelled) setJoinState({ status: "success", classroom: existing });
              return;
            }
          } catch {
            // Show the original join failure if the membership lookup also fails.
          }
        }
        if (!cancelled) setJoinState({ status: "error", message });
      }
    })();
    return () => { cancelled = true; };
  }, [code, isAuthenticated, isInitialized, user]);

  const redirectTarget = `${location.pathname}${location.search}`;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-10">
      <Card className="w-full overflow-hidden">
        <CardContent className="space-y-5 p-6 text-center sm:p-8">
          {!code ? <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700"><AlertCircle className="h-7 w-7" aria-hidden="true" /></div>
            <h1 className="text-xl font-bold theme-text-primary">Liên kết lớp không hợp lệ</h1>
            <p className="text-sm theme-text-secondary">Liên kết không có mã lớp. Mở lại đường dẫn do giáo viên gửi.</p>
            <Button variant="outline" onClick={() => navigate("/student/classes")}>Quay lại</Button>
          </> : !isInitialized ? <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-700" aria-hidden="true" />
            <h1 className="text-xl font-bold theme-text-primary">Đang kiểm tra đăng nhập…</h1>
            <p className="text-sm theme-text-secondary">Mã lớp: <span className="font-mono font-bold">{code}</span></p>
          </> : !isAuthenticated || !user ? <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-800"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /></div>
            <h1 className="text-xl font-bold theme-text-primary">Tham gia lớp học</h1>
            <p className="text-sm theme-text-secondary">Đăng nhập bằng tài khoản học sinh để vào lớp có mã <span className="font-mono font-bold text-blue-800">{code}</span>.</p>
            <Link to={`/login?redirect=${encodeURIComponent(redirectTarget)}`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800">Đăng nhập để tham gia</Link>
          </> : user.role !== "student" ? <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><AlertCircle className="h-7 w-7" aria-hidden="true" /></div>
            <h1 className="text-xl font-bold theme-text-primary">Không thể tham gia lớp</h1>
            <p className="text-sm theme-text-secondary">Chỉ tài khoản ở chế độ học sinh mới có thể tham gia lớp học bằng mã mời.</p>
            <Button variant="outline" onClick={() => navigate("/teacher")}>Quay lại</Button>
          </> : joinState.status === "loading" || joinState.status === "idle" ? <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-700" aria-hidden="true" />
            <h1 className="text-xl font-bold theme-text-primary">Đang tham gia lớp…</h1>
            <p className="text-sm theme-text-secondary">Đang xác nhận mã mời <span className="font-mono font-bold">{code}</span>.</p>
          </> : joinState.status === "error" ? <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-700"><AlertCircle className="h-7 w-7" aria-hidden="true" /></div>
            <h1 className="text-xl font-bold theme-text-primary">Không thể tham gia lớp</h1>
            <p role="alert" className="text-sm theme-text-secondary">{joinState.message}</p>
            <Button variant="outline" onClick={() => navigate("/student/classes")} leftIcon={<ArrowLeft className="h-4 w-4" />}>Quay lại</Button>
          </> : <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><CheckCircle2 className="h-7 w-7" aria-hidden="true" /></div>
            <h1 className="text-xl font-bold theme-text-primary">Bạn đã vào lớp</h1>
            <p className="text-sm theme-text-secondary">Bạn đã tham gia <strong className="theme-text-primary">{joinState.classroom.name}</strong>.</p>
            <Button variant="primary" aria-label="Đi đến lớp học - Tham gia lớp" onClick={() => navigate(`/student/classes/${joinState.classroom.id}`)}>Đi đến lớp học</Button>
          </>}
        </CardContent>
      </Card>
    </div>
  );
}

export default JoinClassByLink;
