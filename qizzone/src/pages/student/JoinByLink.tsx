import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AlertCircle, Lock, ArrowLeft, Loader2 } from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore, isSessionInProgress } from "@/store/examSessionStore";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";

export function JoinByLink() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { quizzes, getQuizByCode, load, isLoading } = useQuizStore();
  const activeSessions = useExamSessionStore((state) => state.activeSessions);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkCode() {
      if (quizzes.length === 0) {
        try {
          await load();
        } catch {
          // handled by store error
        }
      }
      if (isMounted) {
        setChecking(false);
      }
    }

    void checkCode();
    return () => {
      isMounted = false;
    };
  }, [quizzes.length, load]);

  const cleanCode = (code || "").trim().toUpperCase();
  const quiz = cleanCode ? getQuizByCode(cleanCode) : undefined;

  useEffect(() => {
    if (!checking && quiz && quiz.status === "published") {
      const activeSession = activeSessions[quiz.id];
      if (isSessionInProgress(activeSession)) {
        navigate(`/student/quiz/${quiz.id}`, { replace: true });
      } else {
        navigate(`/student/quiz/${quiz.id}/lobby`, { replace: true });
      }
    }
  }, [checking, quiz, activeSessions, navigate]);

  const homePath = user?.role === "student" ? "/student" : user?.role === "teacher" ? "/teacher" : "/";

  if (checking || isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6 space-y-3">
        <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
        <p className="text-sm font-semibold text-neutral-700">
          Đang kết nối tới phòng thi {cleanCode}...
        </p>
      </div>
    );
  }

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
                Mã phòng thi <span className="font-mono font-bold text-rose-700">{cleanCode || "(trống)"}</span> không tồn tại hoặc đã bị xóa. Vui lòng kiểm tra lại link liên kết.
              </p>
            </div>
            <div className="pt-2">
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

  if (quiz.status !== "published") {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center border-amber-200 bg-amber-50/20 shadow-lg">
          <CardContent className="pt-8 pb-6 px-6 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Lock className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-neutral-900">
                Phòng thi chưa mở hoặc đã kết thúc
              </h2>
              <p className="text-sm text-neutral-600 mt-1.5">
                Đề thi <strong>"{quiz.title}"</strong> ({quiz.code}) hiện đang ở trạng thái{" "}
                <span className="font-bold text-amber-800">
                  {quiz.status === "draft" ? "bản nháp" : "đã đóng"}
                </span>
                . Vui lòng liên hệ giáo viên phụ trách để biết thêm chi tiết.
              </p>
            </div>
            <div className="pt-2">
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
