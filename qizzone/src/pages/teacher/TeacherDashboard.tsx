import { useNavigate } from "react-router-dom";
import {
  PlusCircle,
  FileQuestion,
  Users,
  CheckSquare,
  ArrowRight,
  FileUp,
  TrendingUp,
  BarChart2,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
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
  const results = useExamSessionStore((state) => state.results);
  const getResultsByQuiz = useExamSessionStore((state) => state.getResultsByQuiz);

  const publishedCount = quizzes.filter((q) => q.status === "published").length;
  const totalSubmissions = results.length;

  const stats = [
    {
      title: "Tổng số đề thi",
      value: quizzes.length.toString(),
      change: `${publishedCount} đề đang mở thi`,
      icon: FileQuestion,
      color: "text-blue-700 bg-blue-50 border-blue-100",
    },
    {
      title: "Lượt học sinh nộp bài",
      value: totalSubmissions.toString(),
      change: "Chấm điểm tự động",
      icon: Users,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
    },
    {
      title: "Phòng thi đang mở",
      value: publishedCount.toString(),
      change: "Sẵn sàng đón thí sinh",
      icon: CheckSquare,
      color: "text-amber-700 bg-amber-50 border-amber-100",
    },
  ];

  const recentQuizzes = quizzes.slice(0, 4);

  return (
    <div className="space-y-7 pb-12">
      <div className="flex flex-col justify-between gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-blue-700">Tổng quan</p>
          <h1 className="page-heading mt-1">
            Xin chào, {user?.name || user?.fullName || "Thầy Cô"}
          </h1>
          <p className="page-description">
            Theo dõi đề thi, lượt nộp bài và nhanh chóng tạo nội dung mới.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => navigate("/teacher/extract-quiz")}
            leftIcon={<FileUp className="h-4 w-4" />}
          >
            Nhập đề từ tệp
          </Button>

          <Button
            variant="primary"
            onClick={() => navigate("/teacher/create-quiz")}
            leftIcon={<PlusCircle className="h-4 w-4" />}
          >
            Tạo đề thi
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <Card key={idx}>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500">
                    {stat.title}
                  </span>
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-md border ${stat.color}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <span className="font-mono text-3xl font-semibold tracking-tight text-neutral-950">
                    {stat.value}
                  </span>
                  <span className="inline-flex items-center gap-1 text-right text-xs text-neutral-500">
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
            {recentQuizzes.map((quiz) => {
              const submissionCount = getResultsByQuiz(quiz.id).length;

              return (
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
                          ? "Đang mở"
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
                      onClick={() => navigate(`/teacher/quiz/${quiz.id}/results`)}
                      leftIcon={<BarChart2 className="h-3.5 w-3.5 text-indigo-600" />}
                      className="font-semibold text-xs"
                    >
                      Bảng điểm {submissionCount > 0 && `(${submissionCount})`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/teacher/quiz/${quiz.id}/review`)}
                      className="text-xs"
                    >
                      Xem đề
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default TeacherDashboard;
