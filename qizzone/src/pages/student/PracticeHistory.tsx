import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { useAuthStore } from "@/store/authStore";
import { usePracticeStore } from "@/store/practiceStore";

export function PracticeHistory() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const history = usePracticeStore((state) => state.history);
  const historyOwnerId = usePracticeStore((state) => state.historyOwnerId);
  const loadHistory = usePracticeStore((state) => state.loadHistory);
  const isLoading = usePracticeStore((state) => state.isLoadingHistory);
  const error = usePracticeStore((state) => state.historyError);

  useEffect(() => {
    if (user?.id) void loadHistory(user.id).catch(() => {});
  }, [user?.id, loadHistory]);

  const visibleHistory = historyOwnerId === user?.id ? history : [];
  const activeSessions = visibleHistory.filter((session) => session.status === "in_progress");
  const invalidatedSessions = visibleHistory.filter((session) => session.status === "invalidated");
  const completedSessions = visibleHistory.filter((session) => session.status === "completed");
  const isInitialLoading = isLoading && historyOwnerId !== user?.id;
  const showInitialError = !!error && historyOwnerId !== user?.id;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-neutral-900 sm:text-2xl">
            <History className="h-5 w-5 text-emerald-700" />Lịch sử luyện tập
          </h1>
          <p className="mt-1 text-sm text-neutral-500">Tiếp tục lượt đang dở hoặc xem kết quả luyện tập đã hoàn thành.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/student")} leftIcon={<ArrowLeft className="h-4 w-4" />}>
          Về trang học sinh
        </Button>
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => user && void loadHistory(user.id).catch(() => {})}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Làm mới
        </Button>
      </div>

      {isInitialLoading ? (
        <Card><CardContent className="p-6 text-center text-sm text-neutral-500">Đang tải lịch sử luyện tập…</CardContent></Card>
      ) : showInitialError ? (
        <Card className="border-rose-200">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-700">Không tải được lịch sử luyện tập: {error}</p>
            <Button variant="outline" size="sm" onClick={() => user && void loadHistory(user.id).catch(() => {})} isLoading={isLoading}>
              Thử lại
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {(activeSessions.length > 0 || invalidatedSessions.length > 0) && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-neutral-900">Luyện tập đang dở</h2>
              <Card className="overflow-hidden">
                <div className="divide-y divide-neutral-100">
                  {activeSessions.map((session) => (
                    <div key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <div>
                        <p className="text-sm font-bold text-neutral-900">{session.quizTitle}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {session.subject} · Đã kiểm tra {session.answeredCount}/{session.totalQuestions} câu · {new Date(session.startedAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/student/practice/${session.id}/room`)} leftIcon={<Play className="h-3.5 w-3.5" />}>
                        Tiếp tục luyện
                      </Button>
                    </div>
                  ))}
                  {invalidatedSessions.map((session) => (
                    <div key={session.id} className="p-4 sm:px-5">
                      <p className="text-sm font-bold text-neutral-800">{session.quizTitle}</p>
                      <p className="mt-1 text-xs text-amber-800">{session.message || "Đề đã thay đổi nên lượt luyện này không thể tiếp tục."}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Đã hoàn thành ({completedSessions.length})</h2>
              <p className="mt-1 text-xs text-neutral-500">Kết quả luyện tập được lưu riêng, không ảnh hưởng đến kết quả thi.</p>
            </div>

            {completedSessions.length > 0 ? (
              <Card className="overflow-hidden">
                <div className="divide-y divide-neutral-100">
                  {completedSessions.map((session) => (
                    <div key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" size="sm">{session.subject}</Badge>
                          <h3 className="text-sm font-bold text-neutral-900">{session.quizTitle}</h3>
                        </div>
                        <p className="text-xs text-neutral-500">
                          Luyện lúc: {new Date(session.finishedAt || session.startedAt).toLocaleString("vi-VN")}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-4 sm:justify-end">
                        <div className="text-right">
                          <p className="font-mono text-sm font-extrabold text-emerald-800">{session.correctCount}/{session.totalQuestions} câu</p>
                          <p className="text-[11px] text-neutral-500">{session.percentage}% đúng · {session.durationSeconds}s</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => navigate(`/student/practice/${session.quizId}`)}>
                          Luyện lại
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="p-6 text-center text-sm text-neutral-500">
                  {error ? `Không tải được lịch sử luyện tập: ${error}` : "Bạn chưa hoàn thành lượt luyện tập nào."}
                </CardContent>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default PracticeHistory;
