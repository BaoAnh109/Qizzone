import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Clock,
  Award,
  ArrowLeft,
  Play,
  ShieldCheck,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/hooks/useToast";

function cleanStudentName(rawName?: string): string {
  if (!rawName) return "Học sinh";
  return rawName.replace(/^(Em|Học sinh|Thầy|Cô)\s+/i, "").trim() || rawName;
}

export function ExamEntry() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const getQuizById = useQuizStore((state) => state.getQuizById);
  const initSession = useExamSessionStore((state) => state.initSession);
  const toast = useToast();

  const quiz = quizId ? getQuizById(quizId) : undefined;

  const [studentName, setStudentName] = useState(() =>
    cleanStudentName(user?.fullName || user?.name)
  );

  if (!quiz) {
    return (
      <div className="max-w-md mx-auto my-12 text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-neutral-900">
          Không tìm thấy phòng thi
        </h2>
        <p className="text-xs text-neutral-500">
          Mã phòng thi không tồn tại hoặc đã bị gỡ bỏ bởi giáo viên.
        </p>
        <Button variant="outline" onClick={() => navigate("/student")}>
          Quay lại sảnh chính
        </Button>
      </div>
    );
  }

  if (quiz.status !== "published") {
    return (
      <div className="max-w-md mx-auto my-12 text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h2 className="text-xl font-bold text-neutral-900">
          Phòng thi chưa mở
        </h2>
        <p className="text-xs text-neutral-500">
          Đề thi này đang ở trạng thái Bản nháp hoặc Đã đóng bởi Giáo viên.
        </p>
        <Button variant="outline" onClick={() => navigate("/student")}>
          Quay lại sảnh chính
        </Button>
      </div>
    );
  }

  const handleStartExam = () => {
    if (!studentName.trim()) {
      toast.error("Vui lòng nhập Họ và tên thí sinh");
      return;
    }

    // Initialize or resume session
    initSession({
      quiz,
      studentId: user?.id || "guest-student",
      studentName: studentName.trim(),
    });

    toast.success(`Bắt đầu làm bài thi: ${quiz.title}`);
    navigate(`/student/quiz/${quiz.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      {/* Top Back Navigation */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/student")}
        leftIcon={<ArrowLeft className="h-4 w-4" />}
      >
        Quay lại Sảnh thi
      </Button>

      <Card className="overflow-hidden border-neutral-200/90 shadow-md">
        {/* Banner Header */}
        <CardHeader className="bg-linear-to-r from-indigo-900 via-indigo-800 to-violet-900 text-white p-6 sm:p-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" size="sm" className="bg-white/20 text-white border-white/30">
                {quiz.subject}
              </Badge>
              <Badge variant="success" size="sm" dot>
                Phòng thi đang mở
              </Badge>
            </div>
            <CardTitle className="text-2xl sm:text-3xl font-extrabold text-white">
              {quiz.title}
            </CardTitle>
            <p className="text-xs sm:text-sm text-indigo-200">
              Giáo viên tạo đề: {quiz.teacherName || "Thầy Cô"} · Mã phòng:{" "}
              <strong className="font-mono text-white font-bold">{quiz.code}</strong>
            </p>
          </div>
        </CardHeader>

        <CardContent className="p-6 sm:p-8 space-y-6">
          {/* Metadata Highlights */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-200/70">
              <Clock className="h-4 w-4 text-indigo-600 mx-auto mb-1" />
              <p className="text-xs text-neutral-500 font-medium">Thời gian</p>
              <p className="text-sm font-bold text-neutral-900 font-mono mt-0.5">
                {quiz.settings.durationMinutes === 0
                  ? "Vô thời hạn"
                  : `${quiz.settings.durationMinutes} phút`}
              </p>
            </div>

            <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-200/70">
              <BookOpen className="h-4 w-4 text-indigo-600 mx-auto mb-1" />
              <p className="text-xs text-neutral-500 font-medium">Số lượng câu</p>
              <p className="text-sm font-bold text-neutral-900 font-mono mt-0.5">
                {quiz.totalQuestions} câu hỏi
              </p>
            </div>

            <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-200/70">
              <Award className="h-4 w-4 text-indigo-600 mx-auto mb-1" />
              <p className="text-xs text-neutral-500 font-medium">Điểm đạt</p>
              <p className="text-sm font-bold text-neutral-900 font-mono mt-0.5">
                {quiz.settings.passPercentage}%
              </p>
            </div>
          </div>

          {/* Rules & Regulations */}
          <div className="rounded-xl bg-indigo-50/60 p-4 border border-indigo-100/90 text-xs text-indigo-950 space-y-2.5">
            <div className="flex items-center gap-1.5 font-bold text-indigo-900">
              <ShieldCheck className="h-4 w-4 text-indigo-600" />
              <span>Quy chế và hướng dẫn làm bài:</span>
            </div>

            <ol className="space-y-1.5 text-indigo-900/90 pl-5 list-decimal font-normal leading-relaxed">
              <li>
                Hệ thống tự động lưu đáp án sau mỗi lần chọn, chống mất bài khi mất kết nối.
              </li>
              <li>
                {quiz.settings.shuffleQuestions
                  ? "Đề thi có bật tính năng đảo thứ tự câu hỏi ngẫu nhiên."
                  : "Đề thi không bật tính năng đảo thứ tự câu hỏi ngẫu nhiên."}
              </li>
              <li>
                {quiz.settings.durationMinutes === 0
                  ? "Bài thi không giới hạn thời gian làm bài."
                  : "Bài thi sẽ tự động nộp sau khi hết giờ."}
              </li>
              {quiz.description?.trim() && (
                <li className="pt-0.5">
                  <span className="font-semibold text-indigo-950">Ghi chú từ giáo viên:</span>{" "}
                  {quiz.description}
                </li>
              )}
            </ol>
          </div>

          {/* Student Confirmation Form */}
          <div className="space-y-3 pt-2 border-t border-neutral-100">
            <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span>Xác nhận thông tin thí sinh</span>
            </h3>

            <Input
              label="Họ và tên thí sinh *"
              placeholder="Nhập họ và tên thí sinh..."
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
            />
          </div>

          {/* Start Exam CTA */}
          <div className="pt-4">
            <Button
              variant="primary"
              size="lg"
              onClick={handleStartExam}
              className="w-full h-12 text-base font-bold shadow-md shadow-indigo-600/20"
              leftIcon={<Play className="h-5 w-5 fill-current" />}
            >
              Bắt đầu làm bài thi ngay
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ExamEntry;
