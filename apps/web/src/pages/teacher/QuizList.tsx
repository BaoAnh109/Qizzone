import { useEffect, useState } from "react";
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
import type { Quiz, QuizSettings, QuizStatus } from "@/types/quiz";
import type { Classroom, LatePolicy } from "@qizzone/domain";
import { classroomService } from "@/services/classroomService";

function toLocalDateTimeValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function QuizList() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { quizzes, updateQuizAssignments, deleteQuiz, duplicateQuiz, togglePublishStatus } =
    useQuizStore();
  const updatePublishSettings = useQuizStore((state) => state.updatePublishSettings);
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
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroomAssignTarget, setClassroomAssignTarget] = useState<Quiz | null>(null);
  const [selectedClassroomIds, setSelectedClassroomIds] = useState<string[]>([]);
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentHardCloseAt, setAssignmentHardCloseAt] = useState("");
  const [assignmentLatePolicy, setAssignmentLatePolicy] = useState<LatePolicy>("block_after_due");
  const [assignmentError, setAssignmentError] = useState("");
  const [isSavingClassroomAssignment, setIsSavingClassroomAssignment] = useState(false);
  const [publishSettingsTarget, setPublishSettingsTarget] = useState<Quiz | null>(null);
  const [publishSettingsDraft, setPublishSettingsDraft] = useState<Partial<QuizSettings>>({});
  const [isSavingPublishSettings, setIsSavingPublishSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    classroomService.listMyClassrooms()
      .then((items) => {
        if (!cancelled) setClassrooms(items.filter((item) => !item.isArchived));
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Không thể tải danh sách lớp học.");
      });
    return () => { cancelled = true; };
  }, [toast]);

  const handleOpenAssignModal = (quiz: Quiz) => {
    setAssignTarget(quiz);
    setAssignClasses([...(quiz.settings.assignedClasses || [])]);
    setAssignEmails([...(quiz.settings.assignedEmails || [])]);
    setNewClassInput("");
    setNewEmailInput("");
  };

  const handleOpenClassroomAssignment = (quiz: Quiz) => {
    setClassroomAssignTarget(quiz);
    setSelectedClassroomIds([]);
    setAssignmentDueAt("");
    setAssignmentHardCloseAt("");
    setAssignmentLatePolicy("block_after_due");
    setAssignmentError("");
  };

  const handleAssignToClassrooms = async () => {
    if (!classroomAssignTarget) return;
    if (selectedClassroomIds.length === 0) {
      setAssignmentError("Chọn ít nhất một lớp trước khi giao bài.");
      return;
    }
    if (!assignmentDueAt) {
      setAssignmentError("Vui lòng chọn hạn nộp trước khi giao bài.");
      return;
    }
    const dueDate = assignmentDueAt ? new Date(assignmentDueAt) : null;
    const hardCloseDate = assignmentHardCloseAt ? new Date(assignmentHardCloseAt) : null;
    if (dueDate && hardCloseDate && hardCloseDate.getTime() < dueDate.getTime()) {
      setAssignmentError("Hạn cuối phải sau hoặc bằng hạn nộp.");
      return;
    }
    setAssignmentError("");
    setIsSavingClassroomAssignment(true);
    try {
      await classroomService.assignQuizToClassrooms({
        quizId: classroomAssignTarget.id,
        assignments: selectedClassroomIds.map((classroomId) => ({
          classroomId,
          instructions: "",
          dueAt: dueDate?.toISOString() ?? null,
          latePolicy: assignmentLatePolicy,
          hardCloseAt: hardCloseDate?.toISOString() ?? null,
        })),
      });
      toast.success("Đã giao bài cho lớp thành công.");
      setClassroomAssignTarget(null);
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Không thể giao bài cho lớp.");
    } finally {
      setIsSavingClassroomAssignment(false);
    }
  };

  const handleOpenPublishSettings = (quiz: Quiz) => {
    setPublishSettingsTarget(quiz);
    setPublishSettingsDraft({
      publishScope: quiz.settings.publishScope ?? "public",
      opensAt: quiz.settings.opensAt ?? null,
      closesAt: quiz.settings.closesAt ?? null,
      maxAttempts: quiz.settings.maxAttempts,
      shuffleQuestions: quiz.settings.shuffleQuestions,
      shuffleOptions: quiz.settings.shuffleOptions,
      scoreVisibility: quiz.settings.scoreVisibility ?? "immediate",
      answerVisibility: quiz.settings.answerVisibility ?? "immediate",
    });
  };

  const handleSavePublishSettings = async () => {
    if (!publishSettingsTarget) return;
    const opensAt = publishSettingsDraft.opensAt ?? null;
    const closesAt = publishSettingsDraft.closesAt ?? null;
    if (opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
      toast.error("Thời gian đóng đề phải sau thời gian mở đề.");
      return;
    }
    setIsSavingPublishSettings(true);
    try {
      await updatePublishSettings(publishSettingsTarget.id, publishSettingsDraft);
      toast.success("Cập nhật cài đặt phát hành thành công.");
      setPublishSettingsTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật cài đặt phát hành.");
    } finally {
      setIsSavingPublishSettings(false);
    }
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
      <div className="flex flex-col gap-4 border-b theme-border pb-6 sm:flex-row sm:items-end sm:justify-between">
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
      <div className="flex flex-col gap-4 rounded-lg border theme-border theme-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Input
            placeholder="Tìm theo tên đề, môn học, mã phòng..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-md theme-surface-muted p-1 text-xs font-semibold">
          {(["all", "published", "draft", "closed"] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`shrink-0 cursor-pointer rounded px-3 py-1.5 transition-colors ${
                statusFilter === st
                  ? "theme-surface text-blue-700 shadow-sm"
                  : "theme-text-secondary theme-hover-text-primary"
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
                <CardHeader className="pb-3 theme-surface-muted">
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
                  <CardTitle className="text-base font-bold line-clamp-2 leading-snug theme-text-primary">
                    {quiz.title}
                  </CardTitle>
                </CardHeader>

                <CardContent className="pt-3 space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-2.5">
                    {/* Room Code Box */}
                    <div className="flex items-center justify-between rounded-xl bg-teal-50/60 p-2.5 border border-teal-100">
                      <div>
                        <p className="text-[10px] font-bold text-teal-900/70 uppercase tracking-wider">
                          Mã phòng thi:
                        </p>
                        <p className="font-mono font-black text-base text-teal-950 tracking-wider">
                          {quiz.code}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs theme-surface text-teal-900 border-teal-200 hover:bg-teal-100"
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
                          className="h-8 px-2 text-xs theme-surface text-teal-900 border-teal-200 hover:bg-teal-100"
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
                    <div className="grid grid-cols-2 gap-2 text-xs theme-text-muted py-1">
                      <div>
                        Số câu: <strong className="theme-text-primary">{quiz.totalQuestions} câu</strong>
                      </div>
                      <div>
                        Thời gian:{" "}
                        <strong className="theme-text-primary">
                          {quiz.settings.durationMinutes === 0
                            ? "Vô thời hạn"
                            : `${quiz.settings.durationMinutes} phút`}
                        </strong>
                      </div>
                    </div>

                    {/* Phân phối đề thi (Lớp / Email) */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                      {quiz.settings.assignedClasses && quiz.settings.assignedClasses.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 font-semibold border border-teal-200/60">
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
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md theme-surface-muted theme-text-secondary font-medium">
                          <KeyRound className="h-3 w-3" />
                          <span>Vào bằng mã / link</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Action Buttons */}
                  <div className="space-y-2 pt-3 border-t theme-border">
                    {/* Bảng điểm CTA */}
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full font-bold shadow-xs bg-teal-700 hover:bg-teal-800"
                      onClick={() => navigate(`/teacher/quiz/${quiz.id}/results`)}
                      leftIcon={<BarChart2 className="h-3.5 w-3.5" />}
                    >
                      Bảng điểm {submissionCount > 0 && `(${submissionCount} bài nộp)`}
                    </Button>

                    {/* Giao đề CTA */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-full text-teal-700 hover:bg-teal-50 border-teal-200"
                      onClick={() => handleOpenClassroomAssignment(quiz)}
                      leftIcon={<Users className="h-3.5 w-3.5 text-teal-700" />}
                    >
                      Giao bài cho lớp
                    </Button>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 w-full"
                        onClick={() => handleOpenAssignModal(quiz)}
                      >
                        Chọn đối tượng
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 w-full"
                        onClick={() => handleOpenPublishSettings(quiz)}
                      >
                        Cấu hình phát hành
                      </Button>
                    </div>

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
                        className="flex items-center gap-1.5 text-xs font-medium theme-text-secondary hover:text-teal-700 transition cursor-pointer"
                      >
                        {quiz.status === "published" ? (
                          <>
                            <ToggleRight className="h-4 w-4 text-emerald-600" />
                            <span>Hủy xuất bản</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="h-4 w-4 theme-text-muted" />
                            <span>Xuất bản ngay</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDuplicate(quiz.id)}
                          title="Nhân bản đề thi"
                          className="rounded-lg p-1.5 theme-text-muted theme-hover-surface theme-hover-text-primary transition cursor-pointer"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(quiz)}
                          title="Xóa đề thi"
                          className="rounded-lg p-1.5 theme-text-muted hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
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
          <h3 className="text-base font-bold theme-text-primary">
            Không tìm thấy đề thi nào
          </h3>
          <p className="text-xs theme-text-muted mt-1 max-w-sm mx-auto">
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

      {classroomAssignTarget && (
        <Modal
          isOpen={!!classroomAssignTarget}
          onClose={() => setClassroomAssignTarget(null)}
          title="Giao bài cho lớp"
          description={`Chọn lớp và thời hạn cho bài “${classroomAssignTarget.title}”.`}
          size="lg"
          footer={<>
            <Button variant="outline" onClick={() => setClassroomAssignTarget(null)}>Hủy</Button>
            <Button variant="primary" onClick={() => void handleAssignToClassrooms()} isLoading={isSavingClassroomAssignment}>Giao bài</Button>
          </>}
        >
          <div className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold theme-text-primary">Chọn lớp</legend>
              {classrooms.length === 0 ? (
                <p className="rounded-lg theme-surface-muted p-3 text-sm theme-text-secondary">Bạn chưa có lớp đang hoạt động. Tạo lớp trước khi giao bài.</p>
              ) : (
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border theme-border p-2">
                  {classrooms.map((classroom) => {
                    const checkboxId = `assign-class-${classroom.id}`;
                    return <label key={classroom.id} htmlFor={checkboxId} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 theme-hover-surface">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={selectedClassroomIds.includes(classroom.id)}
                        onChange={(event) => setSelectedClassroomIds((current) => event.target.checked ? [...current, classroom.id] : current.filter((id) => id !== classroom.id))}
                        className="h-4 w-4 rounded accent-teal-700"
                      />
                      <span className="text-sm font-medium theme-text-primary">{classroom.name}</span>
                      <span className="ml-auto text-xs theme-text-muted">{classroom.memberCount} học sinh</span>
                    </label>;
                  })}
                </div>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Hạn nộp" type="datetime-local" value={assignmentDueAt} onChange={(event) => { setAssignmentDueAt(event.target.value); setAssignmentError(""); }} />
              <Input label="Đóng hẳn / Hạn cuối (tùy chọn)" type="datetime-local" value={assignmentHardCloseAt} onChange={(event) => { setAssignmentHardCloseAt(event.target.value); setAssignmentError(""); }} />
            </div>
            <label className="block space-y-1.5 text-sm font-medium theme-text-secondary">
              <span>Chính sách nộp muộn</span>
              <select value={assignmentLatePolicy} onChange={(event) => setAssignmentLatePolicy(event.target.value as LatePolicy)} className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                <option value="block_after_due">Chặn sau hạn nộp</option>
                <option value="allow_late">Cho phép nộp muộn</option>
              </select>
            </label>
            {assignmentError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{assignmentError}</p>}
          </div>
        </Modal>
      )}

      {publishSettingsTarget && (
        <Modal
          isOpen={!!publishSettingsTarget}
          onClose={() => setPublishSettingsTarget(null)}
          title="Cấu hình phát hành Azota"
          description={`Cập nhật phạm vi, thời gian và cách hiển thị kết quả cho “${publishSettingsTarget.title}”.`}
          size="lg"
          footer={<>
            <Button variant="outline" onClick={() => setPublishSettingsTarget(null)}>Hủy</Button>
            <Button variant="primary" onClick={() => void handleSavePublishSettings()} isLoading={isSavingPublishSettings}>Lưu cài đặt</Button>
          </>}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium theme-text-secondary sm:col-span-2">
              <span>Phạm vi phát hành</span>
              <select aria-label="Phạm vi phát hành" value={publishSettingsDraft.publishScope ?? "public"} onChange={(event) => setPublishSettingsDraft((current) => ({ ...current, publishScope: event.target.value as QuizSettings["publishScope"] }))} className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                <option value="public">Công khai bằng mã hoặc đường dẫn</option>
                <option value="class_only">Chỉ lớp được giao</option>
              </select>
            </label>
            <Input label="Thời gian mở đề" type="datetime-local" value={toLocalDateTimeValue(publishSettingsDraft.opensAt)} onChange={(event) => setPublishSettingsDraft((current) => ({ ...current, opensAt: event.target.value ? new Date(event.target.value).toISOString() : null }))} />
            <Input label="Thời gian đóng đề" type="datetime-local" value={toLocalDateTimeValue(publishSettingsDraft.closesAt)} onChange={(event) => setPublishSettingsDraft((current) => ({ ...current, closesAt: event.target.value ? new Date(event.target.value).toISOString() : null }))} />
            <Input label="Số lần làm" type="number" min={0} max={100} value={publishSettingsDraft.maxAttempts ?? 0} onChange={(event) => setPublishSettingsDraft((current) => ({ ...current, maxAttempts: Math.max(0, Number(event.target.value) || 0) }))} />
            <label className="space-y-1.5 text-sm font-medium theme-text-secondary">
              <span>Hiển thị điểm</span>
              <select aria-label="Hiển thị điểm" value={publishSettingsDraft.scoreVisibility ?? "immediate"} onChange={(event) => setPublishSettingsDraft((current) => ({ ...current, scoreVisibility: event.target.value as QuizSettings["scoreVisibility"] }))} className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                <option value="immediate">Ngay sau khi nộp</option><option value="after_close">Sau khi đóng đề</option><option value="never">Không hiển thị</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium theme-text-secondary">
              <span>Hiển thị đáp án</span>
              <select aria-label="Hiển thị đáp án" value={publishSettingsDraft.answerVisibility ?? "immediate"} onChange={(event) => setPublishSettingsDraft((current) => ({ ...current, answerVisibility: event.target.value as QuizSettings["answerVisibility"] }))} className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                <option value="immediate">Ngay sau khi nộp</option><option value="after_close">Sau khi đóng đề</option><option value="never">Không hiển thị</option>
              </select>
            </label>
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
              <Users className="h-5 w-5 text-teal-700" />
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
                <label className="text-xs font-bold theme-text-secondary flex items-center gap-1.5 uppercase tracking-wide">
                  <GraduationCap className="h-4 w-4 text-teal-700" />
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
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200"
                    >
                      <span>{cls}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAssignClass(idx)}
                        className="text-teal-400 hover:text-rose-600 transition cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs theme-text-muted italic">
                  Chưa gán cho lớp nào.
                </p>
              )}
            </div>

            {/* Email học sinh */}
            <div className="space-y-2 pt-3 border-t theme-border">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold theme-text-secondary flex items-center gap-1.5 uppercase tracking-wide">
                  <Mail className="h-4 w-4 text-teal-700" />
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
                <p className="text-xs theme-text-muted italic">
                  Chưa gán email học sinh nào.
                </p>
              )}
            </div>

            <div className="rounded-lg theme-surface-muted p-3 border theme-border text-xs theme-text-secondary">
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
