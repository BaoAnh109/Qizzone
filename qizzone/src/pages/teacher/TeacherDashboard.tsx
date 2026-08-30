import { useNavigate } from "react-router-dom";
import {
  PlusCircle,
  FileQuestion,
  Users,
  CheckSquare,
  ArrowRight,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export function TeacherDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const quizzes = useQuizStore((state) => state.quizzes);

  const publishedCount = quizzes.filter((q) => q.status === "published").length;
  const totalQuestions = quizzes.reduce((sum, q) => sum + q.totalQuestions, 0);

  const stats = [
    {
      title: "Tổng số đề thi",
      value: quizzes.length.toString(),
      change: `${publishedCount} đề đã xuất bản`,
      icon: FileQuestion,
      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
    },
    {
      title: "Tổng số câu hỏi",
      value: totalQuestions.toString(),
      change: "Hỗ trợ KaTeX Math",
      icon: Users,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
    },
    {
      title: "Phòng thi đang mở",
      value: publishedCount.toString(),
      change: "Sẵn sàng đón thí sinh",
      icon: CheckSquare,
      color: "text-violet-600 bg-violet-50 border-violet-100",
    },
  ];

  const recentQuizzes = quizzes.slice(0, 4);

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl bg-linear-to-r from-indigo-900 via-indigo-800 to-violet-900 p-6 sm:p-8 text-white shadow-xl shadow-indigo-950/10 sm:flex-row sm:items-center">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-indigo-200 backdrop-blur-xs">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Qizzone Giáo viên Dashboard</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Xin chào, {user?.name || user?.fullName || "Thầy Cô"}! 👋
          </h1>
          <p className="text-sm text-indigo-200/90 max-w-xl">
            Tạo đề thi trắc nghiệm công thức Toán LaTeX, mở phòng thi tức thì và quản lý kết quả học sinh.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="default"
            onClick={() => navigate("/teacher/create-quiz")}
            className="bg-white text-indigo-900 hover:bg-neutral-100 shadow-md font-semibold h-11 px-5"
            leftIcon={<PlusCircle className="h-4 w-4 text-indigo-600" />}
          >
            Tạo đề thi mới
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <Card key={idx} hoverEffect className="relative overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500">
                    {stat.title}
                  </span>
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border ${stat.color}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-3xl font-extrabold tracking-tight text-neutral-900">
                    {stat.value}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {stat.change}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent Quizzes List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle className="text-lg">Đề thi gần đây</CardTitle>
            <CardDescription className="mt-1">
              Danh sách các đề thi bạn đã khởi tạo gần nhất.
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/teacher/quizzes")}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            Xem tất cả
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          <div className="divide-y divide-neutral-100">
            {recentQuizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:px-6 hover:bg-neutral-50/70 transition"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-sm text-neutral-900 truncate">
                      {quiz.title}
                    </h3>
                    <Badge variant={quiz.status} size="sm" dot>
                      {quiz.status === "published"
                        ? "Đã xuất bản"
                        : quiz.status === "closed"
                        ? "Đã đóng"
                        : "Bản nháp"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                    <span className="font-medium text-neutral-700">
                      {quiz.subject}
                    </span>
                    <span>•</span>
                    <span>{quiz.totalQuestions} câu hỏi</span>
                    <span>•</span>
                    <span>
                      {quiz.settings.durationMinutes === 0
                        ? "Vô thời hạn"
                        : `${quiz.settings.durationMinutes} phút`}
                    </span>
                    <span>•</span>
                    <span>
                      Mã phòng:{" "}
                      <strong className="font-mono text-indigo-600">
                        {quiz.code}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/teacher/quiz/${quiz.id}/review`)}
                  >
                    Xem chi tiết
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default TeacherDashboard;