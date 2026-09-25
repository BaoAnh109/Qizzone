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
  FileUp,
  BarChart2,
  Link2,
  Users,
  GraduationCap,
  Mail,
  Plus,
  X,
  KeyRound,
} from "lucide-react";
import { useQuizStore } from "@/store/quizStore";
import { useExamSessionStore } from "@/store/examSessionStore";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";
import type { Quiz, QuizStatus } from "@/types/quiz";

export function QuizList() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { quizzes, updateQuizAssignments, deleteQuiz, duplicateQuiz, togglePublishStatus } =
    useQuizStore();
  const getResultsByQuiz = useExamSessionStore((state) => state.getResultsByQuiz);
  const toast = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuizStatus | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<Quiz | null>(null);
  const [assignTarget, setAssignTarget] = useState<Quiz | null>(null);
  const [assignClasses, setAssignClasses] = useState<string[]>([]);
  const [assignEmails, setAssignEmails] = useState<string[]>([]);
  const [newClassInput, setNewClassInput] = useState("");
  const [newEmailInput, setNewEmailInput] = useState("");
  const [isSavingAssign, setIsSavingAssign] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedLinkCode, setCopiedLinkCode] = useState<string | null>(null);

  const handleOpenAssignModal = (quiz: Quiz) => {
    setAssignTarget(quiz);
    setAssignClasses([...(quiz.settings.assignedClasses || [])]);
    setAssignEmails([...(quiz.settings.assignedEmails || [])]);
    setNewClassInput("");
    setNewEmailInput("");
  };

  const handleAddAssignClass = () => {
    const val = newClassInput.trim();
    if (!val) return;
    if (!assignClasses.some((c) => c.toLowerCase() === val.toLowerCase())) {
      setAssignClasses((prev) => [...prev, val]);
    }
    setNewClassInput("");
  };

  const handleRemoveAssignClass = (idx: number) => {
    setAssignClasses((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddAssignEmails = () => {
    const text = newEmailInput.trim();
    if (!text) return;
    const split = text
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 3 && e.includes("@"));
    if (split.length === 0) {
      toast.error("Vui lòng nhập đúng định dạng email (VD: hsA@gmail.com)");
      return;
    }
    const filtered = split.filter((e) => !assignEmails.includes(e));
    setAssignEmails((prev) => [...prev, ...filtered]);
    setNewEmailInput("");
  };

  const handleRemoveAssignEmail = (idx: number) => {
    setAssignEmails((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveAssign = async () => {
    if (!assignTarget) return;
    setIsSavingAssign(true);
    try {
      await updateQuizAssignments(assignTarget.id, assignClasses, assignEmails);
      toast.success(`Đã cập nhật đối tượng giao bài cho "${assignTarget.title}"`);
      setAssignTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không thể cập nhật phân phối đề thi.");
    } finally {
      setIsSavingAssign(false);
    }
  };

  // Filtered list by role and search
  const roleFilteredQuizzes = user?.role === "admin"
    ? quizzes
    : quizzes.filter((q) => q.teacherId === user?.id);

  const filteredQuizzes = roleFilteredQuizzes.filter((quiz) => {
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

  const handleCopyLink = (code: string) => {
    const joinUrl = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(joinUrl);
    setCopiedLinkCode(code);
    toast.success(`Đã sao chép link làm bài: ${joinUrl}`);
    setTimeout(() => setCopiedLinkCode(null), 2000);
  };

  const handleDuplicate = async (id: string) => {
    try {
      const dup = await duplicateQuiz(id);
      toast.success(`Đã nhân bản đề thi thành công! Mã mới: ${dup.code}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể nhân bản đề thi.");
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      try {
        await deleteQuiz(deleteTarget.id);
        toast.info(`Đã xóa đề thi "${deleteTarget.title}"`);
        setDeleteTarget(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không thể xóa đề thi.");
      }
    }
  };

  const handleTogglePublish = async (id: string) => {
    try {
      const updated = await togglePublishStatus(id);
      toast.success(
        updated.status === "published"
          ? "Đề thi đã được xuất bản công khai"
          : "Đề thi đã được đóng và không nhận thêm lượt làm"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật trạng thái đề thi.");
    }
  };

  return (
    <div className="space-y-7 pb-16">
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Đề thi</p>
          <h1 className="page-heading mt-1">
            Danh sách đề thi
          </h1>
          <p className="page-description">
            Tạo, xuất bản và theo dõi kết quả của từng đề thi.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            onClick={() => navigate("/teacher/extract-quiz")}
            leftIcon={<FileUp className="h-4 w-4" />}
          >
            Nhập từ tệp
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

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            placeholder="Tìm theo tên đề, môn học, mã phòng..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-md bg-neutral-100 p-1 text-xs font-semibold">
          {(["all", "published", "draft", "closed"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`shrink-0 cursor-pointer rounded px-3 py-1.5 transition-colors ${
                statusFilter === st
                  ? "bg-white text-blue-700 shadow-sm"
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredQuizzes.map((quiz) => {
            const submissionCount = getResultsByQuiz(quiz.id).length;

            return (
              <Card
                key={quiz.id}
                hoverEffect
                className="flex flex-col justify-between overflow-hidden"
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

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-100"
                          onClick={() => handleCopyCode(quiz.code)}
                          title="Sao chép mã phòng"
                          leftIcon={
                            copiedCode === quiz.code ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )
                          }
                        >
                          {copiedCode === quiz.code ? "Đã copy" : "Mã"}
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-100"
                          onClick={() => handleCopyLink(quiz.code)}
                          title="Sao chép link làm bài trực tiếp"
                          leftIcon={
                            copiedLinkCode === quiz.code ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Link2 className="h-3.5 w-3.5" />
                            )
                          }
                        >
                          {copiedLinkCode === quiz.code ? "Đã copy" : "Link"}
                        </Button>
                      </div>
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

                    {/* Phân phối đề thi (Lớp / Email) */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                      {quiz.settings.assignedClasses && quiz.settings.assignedClasses.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200/60">
                          <GraduationCap className="h-3 w-3" />
                          <span>Lớp: {quiz.settings.assignedClasses.join(", ")}</span>
                        </span>
                      )}
                      {quiz.settings.assignedEmails && quiz.settings.assignedEmails.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 font-medium border border-sky-200/60">
                          <Mail className="h-3 w-3" />
                          <span>{quiz.settings.assignedEmails.length} email học sinh</span>
                        </span>
                      )}
                      {(!quiz.settings.assignedClasses?.length && !quiz.settings.assignedEmails?.length) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600 font-medium">
                          <KeyRound className="h-3 w-3" />
                          <span>Vào bằng mã / link</span>
                        </span>
                      )}
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

                    {/* Giao đề CTA */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-indigo-700 hover:bg-indigo-50 border-indigo-200"
                      onClick={() => handleOpenAssignModal(quiz)}
                      leftIcon={<Users className="h-3.5 w-3.5 text-indigo-600" />}
                    >
                      Giao đề cho Lớp / Email
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

      {/* Assign Classes / Emails Modal */}
      {assignTarget && (
        <Modal
          isOpen={!!assignTarget}
          onClose={() => setAssignTarget(null)}
          title={
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              <span>Giao đề thi cho Lớp hoặc Email học sinh</span>
            </div>
          }
          description={`Chỉ định đối tượng làm bài cho "${assignTarget.title}" (${assignTarget.code}). Học sinh phù hợp sẽ thấy đề ngay trên trang chủ.`}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setAssignTarget(null)}>
                Hủy bỏ
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveAssign}
                isLoading={isSavingAssign}
                leftIcon={<Check className="h-4 w-4" />}
              >
                Lưu phân phối
              </Button>
            </>
          }
        >
          <div className="space-y-5 py-1">
            {/* Lớp học */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-800 flex items-center gap-1.5 uppercase tracking-wide">
                  <GraduationCap className="h-4 w-4 text-indigo-600" />
                  <span>Chỉ định theo Lớp ({assignClasses.length})</span>
                </label>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Nhập tên lớp (VD: 12A1, 10 Chuyên Tin)..."
                  value={newClassInput}
                  onChange={(e) => setNewClassInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddAssignClass();
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddAssignClass}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Thêm lớp
                </Button>
              </div>

              {assignClasses.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {assignClasses.map((cls, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200"
                    >
                      <span>{cls}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAssignClass(idx)}
                        className="text-indigo-400 hover:text-rose-600 transition cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 italic">
                  Chưa gán cho lớp nào.
                </p>
              )}
            </div>

            {/* Email học sinh */}
            <div className="space-y-2 pt-3 border-t border-neutral-100">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-800 flex items-center gap-1.5 uppercase tracking-wide">
                  <Mail className="h-4 w-4 text-indigo-600" />
                  <span>Chỉ định theo Email học sinh ({assignEmails.length})</span>
                </label>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Nhập email học sinh (VD: emA@school.edu.vn, có thể dán nhiều email)..."
                  value={newEmailInput}
                  onChange={(e) => setNewEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddAssignEmails();
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddAssignEmails}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Thêm email
                </Button>
              </div>

              {assignEmails.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto">
                  {assignEmails.map((email, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-800 border border-sky-200"
                    >
                      <span>{email}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAssignEmail(idx)}
                        className="text-sky-400 hover:text-rose-600 transition cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 italic">
                  Chưa gán email học sinh nào.
                </p>
              )}
            </div>

            <div className="rounded-lg bg-neutral-50 p-3 border border-neutral-200 text-xs text-neutral-600">
              {assignClasses.length === 0 && assignEmails.length === 0 ? (
                <span>
                  🔒 <strong>Mặc định:</strong> Đề thi không hiển thị sẵn trên màn hình trang chủ học sinh (học sinh tham gia qua mã phòng hoặc link chia sẻ).
                </span>
              ) : (
                <span>
                  🎯 <strong>Đã phân phối:</strong> Hiển thị trực tiếp trên trang chủ của học sinh thuộc các lớp hoặc email được giao.
                </span>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default QuizList;
