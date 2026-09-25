import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { AlertCircle, Lock, ArrowLeft, Loader2, LogIn, UserPlus, RefreshCw, Play, Edit, CheckCircle } from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore, isSessionInProgress } from "@/store/examSessionStore";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/Card";
import { useToast } from "@/hooks/useToast";

export function JoinByLink() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const { quizzes, getQuizByCode, load, isLoading, togglePublishStatus } = useQuizStore();
  const activeSessions = useExamSessionStore((state) => state.activeSessions);
  const toast = useToast();

  const [checking, setChecking] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  const cleanCode = (code || "").trim().toUpperCase();

  const fetchLatestQuizzes = useCallback(async () => {
    setChecking(true);
    try {
      await load();
    } catch {
      // Handled by store
    } finally {
      setChecking(false);
    }
  }, [load]);

  useEffect(() => {
    let isMounted = true;

    async function initialCheck() {
      // If code is provided and not found in current store, always fetch from server
      if (cleanCode && !getQuizByCode(cleanCode)) {
        try {
          await load();
        } catch {
          // Handled by store
        }
      } else if (quizzes.length === 0) {
        try {
          await load();
        } catch {
          // Handled by store
        }
      }

      if (isMounted) {
        setChecking(false);
      }
    }

    void initialCheck();
    return () => {
      isMounted = false;
    };
  }, [cleanCode, getQuizByCode, load, quizzes.length]);

  const quiz = cleanCode ? getQuizByCode(cleanCode) : undefined;

  // Auto-redirect if quiz is published and user is authenticated
  useEffect(() => {
    if (!checking && isInitialized && isAuthenticated && quiz && quiz.status === "published") {
      const activeSession = activeSessions[quiz.id];
      if (isSessionInProgress(activeSession)) {
        navigate(`/student/quiz/${quiz.id}`, { replace: true });
      } else {
        navigate(`/student/quiz/${quiz.id}/lobby`, { replace: true });
      }
    }
  }, [checking, isInitialized, isAuthenticated, quiz, activeSessions, navigate]);

  const homePath = user?.role === "student" ? "/student" : user?.role === "teacher" ? "/teacher" : user?.role === "admin" ? "/admin/teacher-approvals" : "/login";

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetCode = manualCode.trim().toUpperCase();
    if (!targetCode) {
      toast.error("Vui lòng nhập mã phòng thi.");
      return;
    }
    navigate(`/join/${targetCode}`);
  };

  const handlePublishNow = async () => {
    if (!quiz) return;
    setIsPublishing(true);
    try {
      await togglePublishStatus(quiz.id);
      toast.success(`Đã xuất bản đề thi "${quiz.title}". Học sinh có thể tham gia ngay!`);
      navigate(`/student/quiz/${quiz.id}/lobby`, { replace: true });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Không thể xuất bản đề thi.");
    } finally {
      setIsPublishing(false);
    }
  };

  // State 1: Code is missing (visited /join directly)
  if (!cleanCode) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center border-indigo-100 shadow-xl bg-white">
          <CardContent className="pt-8 pb-6 px-6 space-y-5">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Play className="h-7 w-7 fill-current ml-0.5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-neutral-900">
                Tham gia phòng thi
              </h2>
              <p className="text-sm text-neutral-500 mt-1">
                Nhập mã 6 ký tự do giáo viên cung cấp để vào phòng làm bài.
              </p>
            </div>
            <form onSubmit={handleManualSubmit} className="space-y-3 pt-2">
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                placeholder="Nhập mã (VD: A1B2C3)"
                maxLength={10}
                className="text-center font-mono font-bold tracking-wider text-lg uppercase"
                autoFocus
              />
              <Button type="submit" variant="primary" className="w-full" size="lg">
                Vào phòng thi
              </Button>
            </form>
            <div className="pt-2">
              <Button
                variant="ghost"
                onClick={() => navigate(homePath)}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                className="text-xs text-neutral-500 hover:text-neutral-800"
              >
                Quay về trang chủ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // State 2: Checking or loading
  if (checking || isLoading || !isInitialized) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-3">
        <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
        <p className="text-sm font-semibold text-neutral-700">
          Đang kết nối tới phòng thi {cleanCode}...
        </p>
      </div>
    );
  }

  // State 3: Quiz not found
  if (!quiz) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center border-rose-200 bg-rose-50/20 shadow-lg">
          <CardContent className="pt-8 pb-6 px-6 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <AlertCircle className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-neutral-900">
                Không tìm thấy phòng thi
              </h2>
              <p className="text-sm text-neutral-600 mt-1.5">
                Mã phòng thi <span className="font-mono font-bold text-rose-700">{cleanCode}</span> không tồn tại hoặc đã bị xóa. Vui lòng kiểm tra lại liên kết.
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => void fetchLatestQuizzes()}
                leftIcon={<RefreshCw className="h-4 w-4" />}
                className="w-full"
              >
                Thử tải lại dữ liệu
              </Button>
              <Button
                variant="primary"
                onClick={() => navigate(homePath)}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                className="w-full"
              >
                Quay về trang chủ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // State 4: Unauthenticated user visiting a valid quiz
  if (!isAuthenticated || !user) {
    const returnUrl = `/join/${cleanCode}`;
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center border-indigo-200 shadow-xl bg-white">
          <CardContent className="pt-8 pb-6 px-6 space-y-5">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Play className="h-7 w-7 fill-current ml-0.5" />
            </div>
            <div>
              <span className="inline-block px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-full bg-indigo-100 text-indigo-800 mb-2 font-mono">
                Mã phòng: {quiz.code}
              </span>
              <h2 className="text-xl font-bold text-neutral-900">
                {quiz.title}
              </h2>
              <p className="text-xs text-neutral-500 mt-1">
                Môn: {quiz.subject} • {quiz.totalQuestions} câu hỏi • {quiz.settings.durationMinutes === 0 ? "Không giới hạn" : `${quiz.settings.durationMinutes} phút`}
              </p>
            </div>
            <p className="text-sm text-neutral-600 bg-neutral-50 rounded-lg p-3 border border-neutral-100">
              Vui lòng đăng nhập hoặc tạo tài khoản để làm bài thi này.
            </p>
            <div className="space-y-2 pt-1">
              <Link to={`/login?redirect=${encodeURIComponent(returnUrl)}`} className="block">
                <Button variant="primary" className="w-full" leftIcon={<LogIn className="h-4 w-4" />}>
                  Đăng nhập để vào thi
                </Button>
              </Link>
              <Link to={`/register?redirect=${encodeURIComponent(returnUrl)}`} className="block">
                <Button variant="outline" className="w-full" leftIcon={<UserPlus className="h-4 w-4" />}>
                  Đăng ký tài khoản mới
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // State 5: Quiz is draft or closed
  if (quiz.status !== "published") {
    const isOwner = user.role === "admin" || (user.role === "teacher" && (quiz.teacherId === user.id || !quiz.teacherId));

    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center border-amber-200 bg-amber-50/20 shadow-lg">
          <CardContent className="pt-8 pb-6 px-6 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Lock className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-neutral-900">
                {quiz.status === "draft" ? "Phòng thi đang là Bản nháp" : "Phòng thi đã kết thúc"}
              </h2>
              <p className="text-sm text-neutral-600 mt-1.5">
                Đề thi <strong>"{quiz.title}"</strong> ({quiz.code}) hiện đang ở trạng thái{" "}
                <span className="font-bold text-amber-800">
                  {quiz.status === "draft" ? "bản nháp" : "đã đóng"}
                </span>.
                {isOwner
                  ? " Vì bạn là giáo viên của đề thi này, bạn có thể xuất bản ngay để học sinh làm bài hoặc chỉnh sửa đề thi."
                  : " Vui lòng liên hệ giáo viên phụ trách để biết thêm chi tiết."}
              </p>
            </div>
            <div className="space-y-2 pt-2">
              {isOwner && quiz.status === "draft" && (
                <>
                  <Button
                    variant="primary"
                    onClick={() => void handlePublishNow()}
                    isLoading={isPublishing}
                    leftIcon={<CheckCircle className="h-4 w-4" />}
                    className="w-full"
                  >
                    Xuất bản ngay & Vào phòng
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/teacher/edit-quiz/${quiz.id}`)}
                    leftIcon={<Edit className="h-4 w-4" />}
                    className="w-full"
                  >
                    Chỉnh sửa đề thi
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                onClick={() => navigate(homePath)}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                className="w-full text-neutral-600"
              >
                Quay về trang chủ
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // State 6: Redirecting to room
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-3">
      <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
      <p className="text-sm font-semibold text-neutral-700">
        Đang chuyển hướng vào phòng thi...
      </p>
    </div>
  );
}

export default JoinByLink;
