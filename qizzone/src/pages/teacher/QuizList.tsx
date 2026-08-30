import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusCircle,
  Search,
  BookOpen,
  Copy,
  Trash2,
  Edit,
  Eye,
  Check,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  BarChart2,
} from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import type { Quiz, QuizStatus } from "@/types/quiz";

export function QuizList() {
  const navigate = useNavigate();
  const { quizzes, deleteQuiz, duplicateQuiz, togglePublishStatus } =
    useQuizStore();
  const getResultsByQuiz = useExamSessionStore((state) => state.getResultsByQuiz);
  const toast = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuizStatus | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<Quiz | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Filtered list
  const filteredQuizzes = quizzes.filter((quiz) => {
    const matchesSearch =
      quiz.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      quiz.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      quiz.code.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ? true : quiz.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Đã sao chép mã phòng: ${code}`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDuplicate = (id: string) => {
    const dup = duplicateQuiz(id);
    if (dup) {
      toast.success(`Đã nhân bản đề thi thành công! Mã mới: ${dup.code}`);
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      deleteQuiz(deleteTarget.id);
      toast.info(`Đã xóa đề thi "${deleteTarget.title}"`);
      setDeleteTarget(null);
    }
  };

  const handleTogglePublish = (id: string) => {
    const updated = togglePublishStatus(id);
    if (updated) {
      toast.success(
        updated.status === "published"
          ? "Đề thi đã được xuất bản công khai"
          : "Đã chuyển đề thi về trạng thái Bản nháp"
      );
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold mb-1">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Teacher Portal · Management</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 tracking-tight">
            Quản lý danh sách đề thi
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-1">
            Tạo, xuất bản, nhân bản đề thi KaTeX và theo dõi mã phòng thi học sinh.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => navigate("/teacher/create-quiz")}
          leftIcon={<PlusCircle className="h-4 w-4" />}
          className="shadow-sm font-bold"
        >
          Tạo đề thi mới
        </Button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-4 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="w-full sm:max-w-xs">
          <Input
            placeholder="Tìm theo tên đề, môn học, mã phòng..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-neutral-100/80 rounded-xl text-xs font-semibold overflow-x-auto">
          {(["all", "published", "draft", "closed"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer shrink-0 ${
                statusFilter === st
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {st === "all"
                ? "Tất cả"
                : st === "published"
                ? "Đang mở"
                : st === "draft"
                ? "Bản nháp"
                : "Đã đóng"}
            </button>
          ))}
        </div>
      </div>

      {/* Quizzes Grid */}
      {filteredQuizzes.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredQuizzes.map((quiz) => {
            const submissionCount = getResultsByQuiz(quiz.id).length;

            return (
              <Card
                key={quiz.id}
                hoverEffect
                className="flex flex-col justify-between border-neutral-200/90 shadow-xs overflow-hidden"
              >
                <CardHeader className="pb-3 bg-neutral-50/50">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <Badge variant="secondary" size="sm">
                      {quiz.subject}
                    </Badge>
                    <Badge variant={quiz.status} size="sm" dot>
                      {quiz.status === "published"
                        ? "Đang mở"
                        : quiz.status === "draft"
                        ? "Bản nháp"
                        : "Đã đóng"}
                    </Badge>
                  </div>
                  <CardTitle className="text-base font-bold line-clamp-2 leading-snug text-neutral-900">
                    {quiz.title}
                  </CardTitle>
                </CardHeader>

                <CardContent className="pt-3 space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    {/* Room Code Box */}
                    <div className="flex items-center justify-between rounded-xl bg-indigo-50/60 p-2.5 border border-indigo-100">
                      <div>
                        <p className="text-[10px] font-bold text-indigo-900/70 uppercase tracking-wider">
                          Mã phòng thi:
                        </p>
                        <p className="font-mono font-black text-base text-indigo-950 tracking-wider">
                          {quiz.code}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-100"
                        onClick={() => handleCopyCode(quiz.code)}
                        leftIcon={
                          copiedCode === quiz.code ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )
                        }
                      >
                        {copiedCode === quiz.code ? "Đã copy" : "Copy"}
                      </Button>
                    </div>

                    {/* Summary Details */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-neutral-500 py-1">
                      <div>
                        Số câu: <strong className="text-neutral-900">{quiz.totalQuestions} câu</strong>
                      </div>
                      <div>
                        Thời gian:{" "}
                        <strong className="text-neutral-900">
                          {quiz.settings.durationMinutes === 0
                            ? "Vô thời hạn"
                            : `${quiz.settings.durationMinutes} phút`}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Card Action Buttons */}
                  <div className="space-y-2 pt-3 border-t border-neutral-100">
                    {/* Bảng điểm CTA */}
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full font-bold shadow-xs bg-indigo-600 hover:bg-indigo-700"
                      onClick={() => navigate(`/teacher/quiz/${quiz.id}/results`)}
                      leftIcon={<BarChart2 className="h-3.5 w-3.5" />}
                    >
                      Bảng điểm {submissionCount > 0 && `(${submissionCount} bài nộp)`}
                    </Button>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/teacher/quiz/${quiz.id}/review`)}
                        leftIcon={<Eye className="h-3.5 w-3.5" />}
                      >
                        Xem đề
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/teacher/edit-quiz/${quiz.id}`)}
                        leftIcon={<Edit className="h-3.5 w-3.5" />}
                      >
                        Sửa đề
                      </Button>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => handleTogglePublish(quiz.id)}
                        className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-indigo-600 transition cursor-pointer"
                      >
                        {quiz.status === "published" ? (
                          <>
                            <ToggleRight className="h-4 w-4 text-emerald-600" />
                            <span>Hủy xuất bản</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="h-4 w-4 text-neutral-400" />
                            <span>Xuất bản ngay</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDuplicate(quiz.id)}
                          title="Nhân bản đề thi"
                          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition cursor-pointer"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(quiz)}
                          title="Xóa đề thi"
                          className="rounded-lg p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="text-center p-12">
          <BookOpen className="h-10 w-10 text-neutral-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-neutral-900">
            Không tìm thấy đề thi nào
          </h3>
          <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
            Không có đề thi nào khớp với điều kiện tìm kiếm hoặc bộ lọc trạng thái hiện tại.
          </p>
        </Card>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <Modal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title="Xác nhận xóa đề thi"
          description={`Bạn có chắc chắn muốn xóa vĩnh viễn đề thi "${deleteTarget.title}"? Thao tác này không thể hoàn tác.`}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Hủy bỏ
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteConfirm}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Xác nhận xóa
              </Button>
            </>
          }
        >
          <div className="rounded-xl bg-rose-50 p-4 border border-rose-200 text-xs text-rose-900">
            <strong>Cảnh báo:</strong> Đề thi bị xóa sẽ không thể khôi phục lại và các mã phòng liên quan sẽ ngừng hoạt động ngay lập tức.
          </div>
        </Modal>
      )}
    </div>
  );
}

export default QuizList;
