import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusCircle,
  Search,
  Copy,
  Check,
  Eye,
  Edit,
  Trash2,
  FileQuestion,
  ToggleLeft,
  ToggleRight,
  Filter,
} from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import type { Quiz } from "@/types/quiz";

export function QuizList() {
  const navigate = useNavigate();
  const { quizzes, deleteQuiz, togglePublishStatus, duplicateQuiz } =
    useQuizStore();
  const toast = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Modal State for Deletion Confirmation
  const [deleteTarget, setDeleteTarget] = useState<Quiz | null>(null);

  const filteredQuizzes = quizzes.filter((q) => {
    const matchesSearch =
      q.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.subject.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      selectedStatus === "all" || q.status === selectedStatus;

    return matchesSearch && matchesStatus;
  });

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Đã sao chép mã phòng ${code} vào bộ nhớ tạm!`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteQuiz(deleteTarget.id);
    toast.success(`Đã xóa đề thi "${deleteTarget.title}" thành công!`);
    setDeleteTarget(null);
  };

  const handleTogglePublish = (id: string) => {
    const updated = togglePublishStatus(id);
    toast.success(
      updated.status === "published"
        ? `Đã xuất bản đề thi! Mã phòng thi: ${updated.code}`
        : "Đã chuyển đề thi về trạng thái Bản nháp."
    );
  };

  const handleDuplicate = (id: string) => {
    const duplicated = duplicateQuiz(id);
    toast.success(`Đã nhân bản đề thi: "${duplicated.title}"`);
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
            <span>Danh sách đề thi của bạn</span>
            <Badge variant="primary" size="sm">
              {quizzes.length} đề thi
            </Badge>
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            Quản lý, chỉnh sửa công thức Toán LaTeX, sao chép mã phòng và mở thi cho học sinh.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => navigate("/teacher/create-quiz")}
          leftIcon={<PlusCircle className="h-4 w-4" />}
        >
          Tạo đề thi mới
        </Button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="flex-1 w-full max-w-md">
          <Input
            placeholder="Tìm theo tên đề, mã phòng, môn học..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <Filter className="h-4 w-4 text-neutral-400 shrink-0 hidden sm:block" />
          {[
            { label: "Tất cả", value: "all" },
            { label: "Đã xuất bản", value: "published" },
            { label: "Bản nháp", value: "draft" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSelectedStatus(item.value)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer shrink-0 ${
                selectedStatus === item.value
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quizzes Grid */}
      {filteredQuizzes.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredQuizzes.map((quiz) => (
            <Card
              key={quiz.id}
              hoverEffect
              className="flex flex-col justify-between border-neutral-200/90 shadow-xs overflow-hidden"
            >
              <CardHeader className="pb-3 bg-neutral-50/40">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                    {quiz.subject}
                  </span>
                  <Badge variant={quiz.status} size="sm" dot>
                    {quiz.status === "published"
                      ? "Đã xuất bản"
                      : quiz.status === "closed"
                      ? "Đã đóng"
                      : "Bản nháp"}
                  </Badge>
                </div>
                <CardTitle className="text-base line-clamp-2 leading-snug font-bold">
                  {quiz.title}
                </CardTitle>
              </CardHeader>

              <CardContent className="pt-4 space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Room Code Card */}
                  <div className="rounded-xl bg-indigo-50/70 p-3 border border-indigo-100/90 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] text-indigo-700 font-semibold">
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
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/teacher/quiz/${quiz.id}/review`)}
                      leftIcon={<Eye className="h-3.5 w-3.5" />}
                    >
                      Xem trước
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
          ))}
        </div>
      ) : (
        <Card className="text-center p-12">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-3">
            <FileQuestion className="h-7 w-7" />
          </div>
          <h3 className="text-base font-bold text-neutral-900">
            Không tìm thấy đề thi nào
          </h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1 mb-4">
            Thử thay đổi từ khóa tìm kiếm hoặc bấm nút bên dưới để tạo một đề thi mới.
          </p>
          <Button
            variant="primary"
            onClick={() => navigate("/teacher/create-quiz")}
            leftIcon={<PlusCircle className="h-4 w-4" />}
          >
            Tạo đề thi mới ngay
          </Button>
        </Card>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Xác nhận xóa đề thi"
        description="Thao tác này không thể hoàn tác sau khi thực hiện."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Hủy bỏ
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              leftIcon={<Trash2 className="h-4 w-4" />}
            >
              Xác nhận xóa
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-neutral-600">
          <p>
            Bạn có chắc chắn muốn xóa đề thi:{" "}
            <strong className="text-neutral-900">
              "{deleteTarget?.title}"
            </strong>{" "}
            (Mã phòng: <span className="font-mono text-indigo-600 font-bold">{deleteTarget?.code}</span>)?
          </p>
          <p className="text-xs text-rose-600">
            Toàn bộ dữ liệu câu hỏi và bảng kết quả liên quan sẽ bị xóa khỏi hệ thống.
          </p>
        </div>
      </Modal>
    </div>
  );
}

export default QuizList;
