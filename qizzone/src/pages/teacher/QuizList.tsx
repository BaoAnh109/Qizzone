import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusCircle, Search, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/hooks/useToast";

export function QuizList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const quizzes = [
    {
      id: "qz-01",
      title: "Kiểm tra Giải tích: Đạo hàm & Khảo sát hàm số",
      subject: "Toán học 12",
      questionsCount: 20,
      submissionsCount: 42,
      roomCode: "QZ9821",
      status: "published" as const,
      createdAt: "30/08/2026",
    },
    {
      id: "qz-02",
      title: "Ôn tập Định luật Newton & Chuyển động tròn",
      subject: "Vật lý 10",
      questionsCount: 15,
      submissionsCount: 28,
      roomCode: "QZ7734",
      status: "active" as const,
      createdAt: "29/08/2026",
    },
    {
      id: "qz-03",
      title: "Hợp chất hữu cơ chứa Nitơ (Amin - Amino Axit)",
      subject: "Hóa học 12",
      questionsCount: 30,
      submissionsCount: 0,
      roomCode: "QZ1045",
      status: "draft" as const,
      createdAt: "28/08/2026",
    },
  ];

  const filteredQuizzes = quizzes.filter(
    (q) =>
      q.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.roomCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Đã sao chép mã phòng ${code} vào bộ nhớ tạm!`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">
            Danh sách đề thi của bạn
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            Quản lý, sao chép mã phòng và theo dõi kết quả các bài kiểm tra.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => navigate("/teacher/create-quiz")}
          leftIcon={<PlusCircle className="h-4 w-4" />}
        >
          Tạo đề mới
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Tìm theo tên đề, mã phòng, môn học..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>
      </div>

      {/* Quizzes Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredQuizzes.map((quiz) => (
          <Card key={quiz.id} hoverEffect className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold text-neutral-500 uppercase">
                  {quiz.subject}
                </span>
                <Badge variant={quiz.status} size="sm" dot>
                  {quiz.status === "published"
                    ? "Đã xuất bản"
                    : quiz.status === "active"
                    ? "Đang mở thi"
                    : "Bản nháp"}
                </Badge>
              </div>
              <CardTitle className="text-base line-clamp-2 leading-snug">
                {quiz.title}
              </CardTitle>
            </CardHeader>

            <CardContent className="pt-0 space-y-4">
              <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-100 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-neutral-400 font-medium">Mã phòng thi:</p>
                  <p className="font-mono font-bold text-sm text-indigo-700">{quiz.roomCode}</p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 text-xs"
                  onClick={() => handleCopyCode(quiz.roomCode)}
                  leftIcon={
                    copiedCode === quiz.roomCode ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )
                  }
                >
                  {copiedCode === quiz.roomCode ? "Đã copy" : "Copy"}
                </Button>
              </div>

              <div className="flex items-center justify-between text-xs text-neutral-500 pt-1 border-t border-neutral-100">
                <span>{quiz.questionsCount} câu hỏi</span>
                <span>{quiz.submissionsCount} lượt nộp</span>
                <span>{quiz.createdAt}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default QuizList;
