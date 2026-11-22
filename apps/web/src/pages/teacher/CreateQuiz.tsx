import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  PlusCircle,
  ClipboardList,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  Settings,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  FileQuestion,
  Clock,
  Users,
  GraduationCap,
  Mail,
  Plus,
  X,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useQuizStore } from "@/store/quizStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MathEditorPreview } from "@/components/common/MathEditorPreview";
import { ImageAttachments } from "@/components/common/ImageAttachments";
import { QuestionContent } from "@/components/common/QuestionContent";
import { MathRenderer } from "@/components/common/MathRenderer";
import { persistQuestionImages } from "@/utils/parsers/questionMedia";
import { useToast } from "@/hooks/useToast";
import { QuizCreationEntry } from "@/components/teacher/QuizCreationEntry";
import type { OptionId, Question, QuizSettings } from "@/types/quiz";

interface CreateQuizLocationState {
  initialQuestions?: Question[];
  initialTitle?: string;
  initialSubject?: string;
  initialDescription?: string;
  initialStep?: 1 | 2 | 3;
  requiresSourceReview?: boolean;
}

const POPULAR_SUBJECTS = [
  "Toán học 12",
  "Toán học 11",
  "Toán học 10",
  "Vật lý 12",
  "Vật lý 11",
  "Vật lý 10",
  "Hóa học 12",
  "Hóa học 11",
  "Hóa học 10",
  "Sinh học 12",
  "Sinh học 11",
  "Sinh học 10",
  "Tiếng Anh",
  "Ngữ văn",
  "Lịch sử",
  "Địa lý",
  "Tin học",
  "GDCD",
  "Đề thi Tổng hợp",
];

function toLocalDateTimeValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateQuiz() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as CreateQuizLocationState | undefined;
  const { quizId } = useParams();
  const user = useAuthStore((state) => state.user);
  const { createQuiz, updateQuiz, getQuizById, updatePublishSettings } = useQuizStore();
  const toast = useToast();

  const isEditing = !!quizId;
  const existingQuiz = quizId ? getQuizById(quizId) : undefined;
  const requiresSourceReview = !isEditing && locationState?.requiresSourceReview === true;

  const [showEntry, setShowEntry] = useState<boolean>(() => {
    if (isEditing) return false;
    if (locationState?.initialQuestions && locationState.initialQuestions.length > 0) return false;
    return true;
  });

  // Permission check for editing
  useEffect(() => {
    if (isEditing && existingQuiz && user) {
      if (user.role !== "admin" && existingQuiz.teacherId && existingQuiz.teacherId !== user.id) {
        toast.error("Bạn không có quyền chỉnh sửa đề thi của giáo viên khác!");
        navigate("/teacher/quizzes", { replace: true });
      }
    }
  }, [isEditing, existingQuiz, user, navigate, toast]);

  // 3-Step Wizard: 1. Soạn câu hỏi -> 2. Xem trước -> 3. Cấu hình phòng thi
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(() => {
    return locationState?.initialStep || 1;
  });

  // Form State
  const [title, setTitle] = useState(
    locationState?.initialTitle || existingQuiz?.title || "Đề kiểm tra trắc nghiệm"
  );
  const [subjectPreset, setSubjectPreset] = useState<string>(() => {
    const rawSubject = locationState?.initialSubject || existingQuiz?.subject;
    if (!rawSubject) return "Toán học 12";
    return POPULAR_SUBJECTS.includes(rawSubject) ? rawSubject : "custom";
  });
  const [customSubject, setCustomSubject] = useState<string>(() => {
    const rawSubject = locationState?.initialSubject || existingQuiz?.subject;
    if (!rawSubject) return "";
    return POPULAR_SUBJECTS.includes(rawSubject) ? "" : rawSubject;
  });

  const resolvedSubject =
    subjectPreset === "custom" ? customSubject.trim() : subjectPreset;

  const [description, setDescription] = useState(
    locationState?.initialDescription || existingQuiz?.description || ""
  );

  const [settings, setSettings] = useState<QuizSettings>(() => existingQuiz
    ? { ...existingQuiz.settings, practiceEnabled: existingQuiz.settings.practiceEnabled !== false }
    : {
        durationMinutes: 45, // 0 = vô thời hạn
        shuffleQuestions: false,
        shuffleOptions: false,
        allowReview: true,
        maxAttempts: 1,
        passPercentage: 50,
        practiceEnabled: true,
        assignedClasses: [],
        assignedEmails: [],
        publishScope: "public",
        opensAt: null,
        closesAt: null,
        scoreVisibility: "immediate",
        answerVisibility: "immediate",
      });

  const [publishWindowError, setPublishWindowError] = useState("");

  const [classInput, setClassInput] = useState("");
  const [emailInput, setEmailInput] = useState("");

  const handleAddClass = (clsToAdd?: string) => {
    const val = (clsToAdd ?? classInput).trim();
    if (!val) return;
    const current = settings.assignedClasses || [];
    if (!current.some((c) => c.toLowerCase() === val.toLowerCase())) {
      setSettings((prev) => ({
        ...prev,
        assignedClasses: [...current, val],
      }));
    }
    setClassInput("");
  };

  const handleRemoveClass = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      assignedClasses: (prev.assignedClasses || []).filter((_, i) => i !== index),
    }));
  };

  const handleAddEmails = (rawEmails?: string) => {
    const text = (rawEmails ?? emailInput).trim();
    if (!text) return;
    const splitEmails = text
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 3 && e.includes("@"));
    if (splitEmails.length === 0) {
      toast.error("Vui lòng nhập đúng định dạng email (VD: emA@school.edu.vn)");
      return;
    }
    const current = settings.assignedEmails || [];
    const newEmails = splitEmails.filter((e) => !current.includes(e));
    setSettings((prev) => ({
      ...prev,
      assignedEmails: [...current, ...newEmails],
    }));
    setEmailInput("");
  };

  const handleRemoveEmail = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      assignedEmails: (prev.assignedEmails || []).filter((_, i) => i !== index),
    }));
  };

  const [questions, setQuestions] = useState<Question[]>(() => {
    return (
      locationState?.initialQuestions ||
      existingQuiz?.questions || [
        {
          id: "q-init-1",
          order: 1,
          content: "Cho hàm số $f(x) = x^2 - 4x + 3$. Tọa độ đỉnh của parabol là:",
          type: "single_choice",
          options: [
            { id: "A", content: "$I(2; -1)$" },
            { id: "B", content: "$I(-2; 1)$" },
            { id: "C", content: "$I(1; 0)$" },
            { id: "D", content: "$I(3; 0)$" },
          ],
          correctAnswers: ["A"],
          explanation:
            "Hoành độ đỉnh $x_I = -\\frac{b}{2a} = 2$. Tung độ đỉnh $y_I = 2^2 - 4(2) + 3 = -1$. Suy ra đỉnh $I(2; -1)$.",
          points: 1,
        },
      ]
    );
  });
  const [reviewedQuestions, setReviewedQuestions] = useState<Question[] | null>(null);
  const sourceReviewed = reviewedQuestions === questions;

  const hydratedQuizId = useRef<string | null>(null);
  useEffect(() => {
    if (!existingQuiz || hydratedQuizId.current === existingQuiz.id) return;
    hydratedQuizId.current = existingQuiz.id;
    setTitle(existingQuiz.title);
    setSubjectPreset(POPULAR_SUBJECTS.includes(existingQuiz.subject) ? existingQuiz.subject : "custom");
    setCustomSubject(POPULAR_SUBJECTS.includes(existingQuiz.subject) ? "" : existingQuiz.subject);
    setDescription(existingQuiz.description || "");
    setSettings({ ...existingQuiz.settings, practiceEnabled: existingQuiz.settings.practiceEnabled !== false });
    setQuestions(existingQuiz.questions);
  }, [existingQuiz]);

  // Question Management Handlers
  const handleAddQuestion = () => {
    const nextOrder = questions.length + 1;
    const newQ: Question = {
      id: `q-${Date.now().toString(36)}`,
      order: nextOrder,
      content: `Nội dung câu hỏi số ${nextOrder} (hỗ trợ công thức Toán $x^2$)...`,
      type: "single_choice",
      options: [
        { id: "A", content: "Đáp án A" },
        { id: "B", content: "Đáp án B" },
        { id: "C", content: "Đáp án C" },
        { id: "D", content: "Đáp án D" },
      ],
      correctAnswers: [],
      explanation: "",
      points: 1,
    };
    setQuestions((prev) => [...prev, newQ]);
    toast.info(`Đã thêm câu hỏi ${nextOrder}`);
  };

  const handleDuplicateQuestion = (index: number) => {
    const target = questions[index];
    const duplicated: Question = {
      ...target,
      id: `q-${Date.now().toString(36)}`,
      order: questions.length + 1,
      content: `${target.content} (Bản sao)`,
    };
    setQuestions((prev) => [...prev, duplicated]);
    toast.success("Đã nhân bản câu hỏi thành công");
  };

  const handleDeleteQuestion = (index: number) => {
    if (questions.length <= 1) {
      toast.warning("Bài thi phải có ít nhất 1 câu hỏi");
      return;
    }
    setQuestions((prev) => prev.filter((_, idx) => idx !== index));
    toast.info("Đã xóa câu hỏi");
  };

  const handleMoveQuestion = (index: number, direction: "up" | "down") => {
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === questions.length - 1)
    ) {
      return;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const reordered = [...questions];
    const temp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = temp;

    setQuestions(reordered.map((q, idx) => ({ ...q, order: idx + 1 })));
  };

  const handleUpdateQuestionContent = (index: number, content: string) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === index ? { ...q, content } : q))
    );
  };

  const handleUpdateOptionContent = (
    questionIndex: number,
    optId: OptionId,
    content: string
  ) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== questionIndex) return q;
        const newOptions = q.options.map((opt) =>
          opt.id === optId ? { ...opt, content } : opt
        );
        return { ...q, options: newOptions };
      })
    );
  };

  const handleToggleCorrectAnswer = (
    questionIndex: number,
    optId: OptionId
  ) => {
    setQuestions((prev) =>
      prev.map((q, idx) => {
        if (idx !== questionIndex) return q;
        return {
          ...q,
          correctAnswers: [optId],
        };
      })
    );
  };

  const handleUpdateExplanation = (
    questionIndex: number,
    explanation: string
  ) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === questionIndex ? { ...q, explanation } : q))
    );
  };

  // Validate and Save
  const handleSaveQuiz = async (status: "draft" | "published") => {
    if (status === "published" && requiresSourceReview && !sourceReviewed) {
      toast.error("Vui lòng xác nhận đã rà soát câu hỏi, phương án và đáp án theo tài liệu gốc.");
      setCurrentStep(2);
      return;
    }
    if (!title.trim()) {
      toast.error("Vui lòng nhập tiêu đề bài thi");
      setCurrentStep(3);
      return;
    }

    if (!resolvedSubject) {
      toast.error("Vui lòng chọn hoặc nhập môn học / khối lớp");
      setCurrentStep(3);
      return;
    }

    if (status === "published" && settings.opensAt && settings.closesAt && new Date(settings.closesAt).getTime() <= new Date(settings.opensAt).getTime()) {
      setPublishWindowError("Thời gian đóng đề phải sau thời gian mở đề.");
      setCurrentStep(3);
      return;
    }
    setPublishWindowError("");

    // Check questions validity
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.content.trim()) {
        toast.error(`Nội dung câu hỏi số ${i + 1} không được để trống`);
        setCurrentStep(1);
        return;
      }
      const optionIds = q.options.map((option) => option.id);
      if (
        q.options.length < 2 ||
        q.options.length > 5 ||
        q.options.some((option) => !option.content.trim()) ||
        new Set(optionIds).size !== optionIds.length
      ) {
        toast.error(`Câu ${i + 1} cần có từ 2 đến 5 phương án hợp lệ, không trùng nhãn.`);
        setCurrentStep(1);
        return;
      }
      if (!q.correctAnswers || q.correctAnswers.length === 0) {
        toast.error(`Vui lòng chọn đáp án đúng cho câu hỏi ${i + 1}`);
        setCurrentStep(1);
        return;
      }
      if (q.correctAnswers.some((answer) => !optionIds.includes(answer))) {
        toast.error(`Đáp án đúng của câu ${i + 1} không có trong các phương án.`);
        setCurrentStep(1);
        return;
      }
    }

    try {
      const questionsWithStoredImages = await persistQuestionImages(questions, user?.id);
      const publishSettings: Partial<QuizSettings> = {
        publishScope: settings.publishScope ?? "public",
        opensAt: settings.opensAt ?? null,
        closesAt: settings.closesAt ?? null,
        maxAttempts: settings.maxAttempts,
        shuffleQuestions: settings.shuffleQuestions,
        shuffleOptions: settings.shuffleOptions,
        scoreVisibility: settings.scoreVisibility ?? "immediate",
        answerVisibility: settings.answerVisibility ?? (settings.allowReview ? "immediate" : "never"),
      };
      if (isEditing && quizId) {
        await updateQuiz(quizId, {
        title: title.trim(),
        subject: resolvedSubject,
        description: description.trim(),
        settings,
        questions: questionsWithStoredImages,
        status,
        });
        await updatePublishSettings(quizId, publishSettings);
        toast.success(
        status === "published"
          ? "Đề thi đã được xuất bản và cập nhật thành công!"
          : "Đã lưu bản nháp đề thi thành công!"
        );
      } else {
        const created = await createQuiz({
        title: title.trim(),
        subject: resolvedSubject,
        description: description.trim(),
        teacherId: user?.id || "user-tea-001",
        teacherName: user?.fullName || user?.name || "Giáo viên",
        code: "",
        status,
        settings,
        questions: questionsWithStoredImages,
        totalQuestions: questionsWithStoredImages.length,
        totalPoints: Math.round(questionsWithStoredImages.reduce((sum, q) => sum + (q.points || 1), 0) * 100) / 100,
        });
        await updatePublishSettings(created.id, publishSettings);

        toast.success(
        status === "published"
          ? `Xuất bản thành công! Mã phòng thi: ${created.code}`
          : "Đã lưu bản nháp đề thi thành công!"
        );
      }
      navigate("/teacher/quizzes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể lưu đề thi. Vui lòng thử lại!");
    }
  };

  if (showEntry && !isEditing) {
    return (
      <div className="pb-16">
        <QuizCreationEntry
          onManualCreate={() => setShowEntry(false)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b theme-border pb-5">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-blue-700">
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Soạn đề thi</span>
          </div>
          <h1 className="page-heading">
            {isEditing ? "Chỉnh sửa đề thi" : "Soạn thảo đề thi mới"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {!isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEntry(true)}
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              className="theme-text-secondary theme-hover-text-primary"
            >
              Đổi cách tạo đề
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSaveQuiz("draft")}
          >
            Lưu bản nháp
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => handleSaveQuiz("published")}
            disabled={requiresSourceReview && !sourceReviewed}
            leftIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            {isEditing ? "Cập nhật & Xuất bản" : "Xuất bản đề thi"}
          </Button>
        </div>
      </div>

      {requiresSourceReview && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <label className="flex cursor-pointer items-start gap-3 font-medium">
            <input
              type="checkbox"
              checked={sourceReviewed}
              onChange={(event) => setReviewedQuestions(event.target.checked ? questions : null)}
              className="mt-0.5 h-4 w-4 accent-teal-700"
            />
            <span>Tôi đã đối chiếu toàn bộ câu hỏi, phương án và đáp án với tài liệu gốc; đã xử lý các cảnh báo trước khi xuất bản.</span>
          </label>
          <p className="mt-2 pl-7 text-xs">Nếu còn câu thiếu phương án hoặc đáp án, hãy quay lại bước bóc tách để bổ sung thủ công. Hệ thống không tự chọn đáp án thay bạn.</p>
        </div>
      )}

      {/* 3-Step Wizard Navigation Tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border theme-border theme-surface-muted p-1 text-xs font-semibold sm:text-sm">
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl transition cursor-pointer ${
            currentStep === 1
              ? "theme-surface text-teal-700 shadow-xs font-bold"
              : "theme-text-secondary theme-hover-text-primary"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-[11px] text-teal-700 font-mono font-bold">
            1
          </span>
          <span className="truncate">1. Soạn câu hỏi ({questions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentStep(2)}
          className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl transition cursor-pointer ${
            currentStep === 2
              ? "theme-surface text-teal-700 shadow-xs font-bold"
              : "theme-text-secondary theme-hover-text-primary"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-[11px] text-teal-700 font-mono font-bold">
            2
          </span>
          <span className="truncate">2. Xem trước đề thi</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentStep(3)}
          className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl transition cursor-pointer ${
            currentStep === 3
              ? "theme-surface text-teal-700 shadow-xs font-bold"
              : "theme-text-secondary theme-hover-text-primary"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 text-[11px] text-teal-700 font-mono font-bold">
            3
          </span>
          <span className="truncate">3. Cấu hình phòng thi</span>
        </button>
      </div>

      {/* STEP 1: SOẠN CÂU HỎI & TIÊU ĐỀ */}
      {currentStep === 1 && (
        <div className="space-y-6">
          {/* Quick Title Card */}
          <Card>
            <CardContent className="p-4 sm:p-6">
              <Input
                label="Tiêu đề đề thi *"
                placeholder="VD: Kiểm tra 1 tiết Giải tích 12: Đạo hàm & Khảo sát hàm số"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-base font-medium"
              />
            </CardContent>
          </Card>

          {/* Question List Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold theme-text-primary flex items-center gap-2">
              <FileQuestion className="h-5 w-5 text-teal-700" />
              <span>Danh sách câu hỏi ({questions.length} câu)</span>
            </h2>

            <Button
              variant="primary"
              size="sm"
              onClick={handleAddQuestion}
              leftIcon={<PlusCircle className="h-4 w-4" />}
            >
              Thêm câu hỏi mới
            </Button>
          </div>

          {/* Question Cards */}
          <div className="space-y-6">
            {questions.map((question, qIdx) => (
              <Card
                key={question.id || qIdx}
                className="theme-border shadow-xs"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-3 theme-surface-muted">
                  <div className="flex items-center gap-2">
                    <Badge variant="primary" size="md">
                      Câu {qIdx + 1}
                    </Badge>
                    <span className="text-xs theme-text-muted">
                      (Điểm: {Number((question.points || 1).toFixed(2))} đ)
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={qIdx === 0}
                      onClick={() => handleMoveQuestion(qIdx, "up")}
                      title="Chuyển lên"
                      className="h-8 w-8 p-0"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={qIdx === questions.length - 1}
                      onClick={() => handleMoveQuestion(qIdx, "down")}
                      title="Chuyển xuống"
                      className="h-8 w-8 p-0"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDuplicateQuestion(qIdx)}
                      title="Nhân bản câu hỏi"
                      className="h-8 w-8 p-0"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteQuestion(qIdx)}
                      title="Xóa câu hỏi"
                      className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 pt-4">
                  {/* Question Content Prompt with KaTeX */}
                  <MathEditorPreview
                    label="Nội dung câu hỏi (hỗ trợ $công thức KaTeX$) *"
                    value={question.content}
                    onChange={(val) => handleUpdateQuestionContent(qIdx, val)}
                    placeholder="Nhập nội dung câu hỏi hoặc công thức Toán $f(x) = x^2$..."
                    rows={3}
                  />
                  <ImageAttachments images={question.images} alt={`Hình trong nội dung câu ${question.order}`} />

                  {/* 4 Options */}
                  <div className="space-y-3 pt-2">
                    <p className="text-xs font-bold theme-text-secondary uppercase tracking-wider">
                      Các lựa chọn đáp án (Click nút đáp án để chọn đáp án đúng):
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {question.options.map((opt) => {
                        const isCorrect = question.correctAnswers.includes(
                          opt.id
                        );
                        return (
                          <div
                            key={opt.id}
                            className={`flex flex-col gap-2 rounded-xl border p-3 transition ${
                              isCorrect
                                ? "border-emerald-500 bg-emerald-50/40"
                                : "theme-border theme-surface"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleCorrectAnswer(qIdx, opt.id)
                                }
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                                  isCorrect
                                    ? "bg-emerald-600 text-white shadow-2xs"
                                    : "theme-surface-muted theme-text-secondary theme-hover-surface"
                                }`}
                              >
                                {isCorrect && (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  Đáp án {opt.id} {isCorrect && "(Đúng)"}
                                </span>
                              </button>
                            </div>

                            <MathEditorPreview
                              value={opt.content}
                              onChange={(val) =>
                                handleUpdateOptionContent(qIdx, opt.id, val)
                              }
                              placeholder={`Nội dung lựa chọn ${opt.id}...`}
                              rows={2}
                            />
                            <ImageAttachments images={opt.images} alt={`Hình minh họa đáp án ${opt.id}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Explanation */}
                  <div className="pt-2">
                    <MathEditorPreview
                      label="Lời giải chi tiết / Hướng dẫn giải (Tùy chọn)"
                      value={question.explanation || ""}
                      onChange={(val) => handleUpdateExplanation(qIdx, val)}
                      placeholder="Nhập phương pháp giải hoặc lời giải chi tiết chứa công thức $...$"
                      rows={2}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4">
            <Button
              variant="outline"
              onClick={handleAddQuestion}
              leftIcon={<PlusCircle className="h-4 w-4" />}
            >
              Thêm câu hỏi nữa
            </Button>

            <Button
              variant="primary"
              onClick={() => setCurrentStep(2)}
              rightIcon={<ArrowRight className="h-4 w-4" />}
            >
              Xem trước bài thi
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: XEM TRƯỚC BÀI THI (PREVIEW) */}
      {currentStep === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="theme-surface-muted">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <Badge
                    variant="secondary"
                    size="sm"
                    className="mb-2"
                  >
                    {resolvedSubject || "Môn học chưa chọn"}
                  </Badge>
                  <CardTitle className="text-xl sm:text-2xl">
                    {title || "Đề thi chưa đặt tên"}
                  </CardTitle>
                </div>

                <div className="flex shrink-0 items-center gap-3 rounded-md border theme-border theme-surface px-4 py-2.5 text-xs font-medium theme-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-teal-300" />
                    <span>
                      {settings.durationMinutes === 0
                        ? "Vô thời hạn"
                        : `${settings.durationMinutes} phút`}
                    </span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-teal-300" />
                    <span>{questions.length} câu hỏi</span>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              <div className="space-y-6">
                {questions.map((q, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border theme-border theme-surface p-5 space-y-4 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-sm font-semibold theme-text-primary flex items-start gap-2">
                        <span className="font-bold text-teal-700 shrink-0">
                          Câu {idx + 1}:
                        </span>
                        <div className="flex-1">
                          <QuestionContent content={q.content} images={q.images} />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {q.options.map((opt) => {
                        const isCorrect = q.correctAnswers.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                              isCorrect
                                ? "border-emerald-500 bg-emerald-50/70 text-emerald-950 font-medium"
                                : "theme-border theme-surface-muted theme-text-secondary"
                            }`}
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-bold text-xs ${
                                isCorrect
                                  ? "bg-emerald-600 text-white"
                                  : "theme-surface-inset theme-text-secondary"
                              }`}
                            >
                              {opt.id}
                            </span>
                            <div className="flex-1 min-w-0">
                              <QuestionContent content={opt.content} images={opt.images} imageAlt={`Hình minh họa đáp án ${opt.id}`} />
                            </div>
                            {isCorrect && (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 ml-auto" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {q.explanation && (
                      <div className="rounded-lg bg-teal-50/60 p-3 border border-teal-100 text-xs text-teal-950">
                        <strong className="text-teal-900">
                          Lời giải chi tiết:{" "}
                        </strong>
                        <MathRenderer content={q.explanation} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-6 border-t theme-border">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(1)}
                  leftIcon={<ArrowLeft className="h-4 w-4" />}
                >
                  Quay lại chỉnh sửa câu hỏi
                </Button>

                <Button
                  variant="primary"
                  onClick={() => setCurrentStep(3)}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                >
                  Chuyển sang Cấu hình phòng thi
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STEP 3: CẤU HÌNH PHÒNG THI & XUẤT BẢN */}
      {currentStep === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-teal-700" />
                <CardTitle>Thông tin bài thi & Cấu hình phòng thi</CardTitle>
              </div>
              <CardDescription>
                Nhập tiêu đề, chọn môn khối lớp, cấu hình thời gian làm bài và quy chế thi.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Box nhập tên đề thi */}
              <Input
                label="Tiêu đề đề thi *"
                placeholder="VD: Kiểm tra Giải tích 12: Đạo hàm & Khảo sát hàm số"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-base font-medium"
              />

              {/* 2 Cột: Bên trái Khối môn, Bên phải Thời gian làm bài (2 box ngang bằng nhau) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                {/* Cột trái: Combo box Chọn môn học */}
                <div className="space-y-1.5 text-left">
                  <label className="text-sm font-semibold theme-text-secondary select-none">
                    Môn học / Khối lớp *
                  </label>

                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 theme-text-muted">
                      <BookOpen className="h-4 w-4" />
                    </div>

                    <select
                      value={subjectPreset}
                      onChange={(e) => setSubjectPreset(e.target.value)}
                      className="h-10 w-full appearance-none rounded-xl border theme-border-strong theme-surface px-3.5 pl-10 pr-9 text-sm theme-text-primary shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:border-teal-600 cursor-pointer"
                    >
                      {POPULAR_SUBJECTS.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                      <option value="custom">-- Môn khác (Tự nhập tay) --</option>
                    </select>

                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 theme-text-muted">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>

                  {subjectPreset === "custom" && (
                    <div className="pt-2 animate-in fade-in">
                      <Input
                        placeholder="Nhập tên môn học / khối lớp..."
                        value={customSubject}
                        onChange={(e) => setCustomSubject(e.target.value)}
                        leftIcon={<BookOpen className="h-4 w-4" />}
                      />
                    </div>
                  )}
                </div>

                {/* Cột phải: Thời gian làm bài (ngang hàng hoàn toàn với Box môn học) */}
                <div className="space-y-1.5 text-left">
                  <Input
                    label="Thời gian làm bài (Phút) *"
                    type="number"
                    min={0}
                    max={300}
                    placeholder="VD: 45 hoặc 0 để không giới hạn"
                    value={settings.durationMinutes}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings((prev) => ({
                        ...prev,
                        durationMinutes: isNaN(val) || val < 0 ? 0 : val,
                      }));
                    }}
                    leftIcon={<Clock className="h-4 w-4" />}
                  />

                  {/* Thông tin hiển thị & Badge màu đặt phía dưới Box nhập */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                    <p className="text-[11px] font-medium theme-text-muted">
                      * Nhập <span className="font-mono font-bold text-teal-700">"0"</span>: Không giới hạn làm bài
                    </p>

                    {settings.durationMinutes === 0 ? (
                      <Badge variant="success" size="sm" dot>
                        Vô thời hạn
                      </Badge>
                    ) : (
                      <Badge variant="primary" size="sm">
                        Thời gian làm bài: {settings.durationMinutes} phút
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Mô tả & Hướng dẫn quy chế thi */}
              <div className="pt-2">
                <Textarea
                  label="Mô tả & Hướng dẫn quy chế thi"
                  placeholder="Ví dụ: Đề thi gồm các câu hỏi trắc nghiệm khách quan. Thí sinh được sử dụng máy tính bỏ túi..."
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <section aria-labelledby="azota-settings-heading" className="space-y-4 rounded-xl border border-teal-200 bg-teal-50/30 p-4 sm:p-5">
                <div>
                  <h3 id="azota-settings-heading" className="text-base font-bold theme-text-primary">Thiết lập phát hành Azota</h3>
                  <p className="mt-1 text-sm theme-text-secondary">Chọn phạm vi, thời gian mở đề và cách học sinh xem kết quả.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <fieldset className="space-y-2 sm:col-span-2">
                    <legend className="text-sm font-medium theme-text-secondary">Phạm vi phát hành</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border theme-border px-3 py-2 text-sm theme-text-primary"><input type="radio" name="publishScope" value="public" checked={(settings.publishScope ?? "public") === "public"} onChange={() => setSettings((current) => ({ ...current, publishScope: "public" }))} className="h-4 w-4 accent-teal-700" />Mọi học sinh</label>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border theme-border px-3 py-2 text-sm theme-text-primary"><input type="radio" name="publishScope" value="class_only" checked={settings.publishScope === "class_only"} onChange={() => setSettings((current) => ({ ...current, publishScope: "class_only" }))} className="h-4 w-4 accent-teal-700" />Chỉ lớp được giao</label>
                    </div>
                  </fieldset>
                  <Input label="Thời gian mở đề (Mở bài từ)" type="datetime-local" value={toLocalDateTimeValue(settings.opensAt)} onChange={(event) => { setPublishWindowError(""); setSettings((current) => ({ ...current, opensAt: event.target.value ? new Date(event.target.value).toISOString() : null })); }} />
                  <Input label="Thời gian đóng đề (Đóng bài lúc)" type="datetime-local" value={toLocalDateTimeValue(settings.closesAt)} onChange={(event) => { setPublishWindowError(""); setSettings((current) => ({ ...current, closesAt: event.target.value ? new Date(event.target.value).toISOString() : null })); }} />
                  <Input label="Số lần làm tối đa" type="number" min={1} max={100} value={settings.maxAttempts} onChange={(event) => { const value = Number(event.target.value); setSettings((current) => ({ ...current, maxAttempts: Number.isFinite(value) ? Math.max(1, value) : 1 })); }} helperText="Từ 1 đến 100 lần làm." />
                  <label className="space-y-1.5 text-sm font-medium theme-text-secondary">
                    <span>Hiển thị điểm</span>
                    <select aria-label="Hiển thị điểm" value={settings.scoreVisibility ?? "immediate"} onChange={(event) => setSettings((current) => ({ ...current, scoreVisibility: event.target.value as QuizSettings["scoreVisibility"] }))} className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                      <option value="immediate">Ngay sau khi nộp</option><option value="after_close">Sau khi đóng đề</option><option value="never">Không hiển thị</option>
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm font-medium theme-text-secondary">
                    <span>Hiển thị đáp án</span>
                    <select aria-label="Hiển thị đáp án" value={settings.answerVisibility ?? "immediate"} onChange={(event) => setSettings((current) => ({ ...current, answerVisibility: event.target.value as QuizSettings["answerVisibility"] }))} className="theme-control min-h-11 w-full rounded-lg border px-3.5 py-2.5 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
                      <option value="immediate">Ngay sau khi nộp</option><option value="after_close">Sau khi đóng đề</option><option value="never">Không hiển thị</option>
                    </select>
                  </label>
                </div>
                {publishWindowError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{publishWindowError}</p>}
              </section>

              {/* Quy chế phòng thi & Bảo mật */}
              <div className="space-y-4 pt-3 border-t theme-border">
                <p className="text-xs font-bold theme-text-secondary uppercase tracking-wider">
                  Quy chế phòng thi & Bảo mật:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-start gap-3 rounded-xl border theme-border p-4 cursor-pointer theme-hover-surface transition">
                    <input
                      type="checkbox"
                      checked={settings.shuffleQuestions}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          shuffleQuestions: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-teal-700 focus:ring-teal-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-semibold theme-text-primary">
                        Đảo thứ tự câu hỏi
                      </p>
                      <p className="text-xs theme-text-muted">
                        Mỗi học sinh sẽ nhận được thứ tự câu hỏi ngẫu nhiên.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border theme-border p-4 cursor-pointer theme-hover-surface transition">
                    <input
                      type="checkbox"
                      checked={settings.shuffleOptions}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          shuffleOptions: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-teal-700 focus:ring-teal-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-semibold theme-text-primary">
                        Đảo thứ tự đáp án (A, B, C, D, E)
                      </p>
                      <p className="text-xs theme-text-muted">
                        Xáo trộn các lựa chọn để chống nhìn bài.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border theme-border p-4 cursor-pointer theme-hover-surface transition">
                    <input
                      type="checkbox"
                      checked={settings.allowReview}
                      aria-labelledby="allow-review-label"
                      aria-describedby="allow-review-description"
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          allowReview: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-teal-700 focus:ring-teal-500 cursor-pointer"
                    />
                    <div>
                      <p id="allow-review-label" className="text-sm font-semibold theme-text-primary">
                        Cho xem lại lời giải chi tiết
                      </p>
                      <p id="allow-review-description" className="text-xs theme-text-muted">
                        Hiển thị đáp án đúng và lời giải sau khi nộp bài.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 cursor-pointer hover:bg-emerald-50 transition sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={settings.practiceEnabled !== false}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          practiceEnabled: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-semibold theme-text-primary">
                        Cho phép học sinh luyện tập đề này
                      </p>
                      <p className="text-xs theme-text-muted">
                        Mặc định bật, kể cả với đề đã tạo trước đây. Cài đặt và lượt thi vẫn giữ nguyên khi đổi mục này.
                      </p>
                    </div>
                  </label>

                  <div className="rounded-xl border theme-border p-4 space-y-2">
                    <p className="text-sm font-semibold theme-text-primary">
                      Điểm đạt yêu cầu (%):
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={settings.passPercentage}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            passPercentage: Number(e.target.value),
                          }))
                        }
                        className="flex-1 accent-teal-600 cursor-pointer"
                      />
                      <span className="font-mono font-bold text-sm text-teal-700 w-12 text-right">
                        {settings.passPercentage}%
                      </span>
                    </div>
                  </div>

                </div>
              </div>

              {/* Phân phối đề thi & Giới hạn đối tượng */}
              <div className="rounded-xl border border-teal-100 theme-surface p-6 shadow-xs space-y-6">
                <div className="border-b theme-border pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold theme-text-primary">
                        Phân phối đề thi (Giao cho Lớp hoặc Email học sinh)
                      </h3>
                      <p className="text-xs theme-text-muted mt-0.5">
                        Học sinh thuộc lớp hoặc có email được giao sẽ thấy ngay đề thi trên trang chủ mà không cần nhập mã.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 1. Giao theo Lớp */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold theme-text-secondary flex items-center gap-1.5">
                      <GraduationCap className="h-4 w-4 text-teal-700" />
                      <span>Chỉ định theo Lớp học</span>
                    </label>
                    <span className="text-xs theme-text-muted">
                      {(settings.assignedClasses || []).length} lớp đã chọn
                    </span>
                  </div>
                  
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nhập tên lớp (VD: 12A1, 10 Chuyên Toán) rồi nhấn Thêm..."
                      value={classInput}
                      onChange={(e) => setClassInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddClass();
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleAddClass()}
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      Thêm lớp
                    </Button>
                  </div>

                  {/* List of assigned classes */}
                  {(settings.assignedClasses || []).length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {settings.assignedClasses!.map((cls, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200"
                        >
                          <span>{cls}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveClass(idx)}
                            className="text-teal-400 hover:text-rose-600 transition cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs theme-text-muted italic">
                      Chưa gán cho lớp cụ thể nào.
                    </p>
                  )}
                </div>

                {/* 2. Giao theo Email học sinh */}
                <div className="space-y-3 pt-4 border-t theme-border">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold theme-text-secondary flex items-center gap-1.5">
                      <Mail className="h-4 w-4 text-teal-700" />
                      <span>Chỉ định theo Email học sinh</span>
                    </label>
                    <span className="text-xs theme-text-muted">
                      {(settings.assignedEmails || []).length} email đã thêm
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      placeholder="Nhập email học sinh (VD: emA@school.edu.vn, có thể dán nhiều email cách nhau dấu phẩy)..."
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddEmails();
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleAddEmails()}
                      leftIcon={<Plus className="h-4 w-4" />}
                    >
                      Thêm email
                    </Button>
                  </div>

                  {/* List of assigned emails */}
                  {(settings.assignedEmails || []).length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1 max-h-40 overflow-y-auto">
                      {settings.assignedEmails!.map((email, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-800 border border-sky-200"
                        >
                          <span>{email}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveEmail(idx)}
                            className="text-sky-400 hover:text-rose-600 transition cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs theme-text-muted italic">
                      Chưa gán email đích danh nào.
                    </p>
                  )}
                </div>

                {/* Scope Note */}
                <div className="rounded-lg theme-surface-muted p-3.5 border theme-border text-xs theme-text-secondary flex items-start gap-2.5">
                  <div className="mt-0.5 text-base">ℹ️</div>
                  <div>
                    {(!settings.assignedClasses?.length && !settings.assignedEmails?.length) ? (
                      <p>
                        <strong className="theme-text-secondary">Mặc định:</strong> Đề thi sẽ <strong>không hiển thị sẵn trên màn hình trang chủ học sinh</strong>. Học sinh vẫn có thể tham gia bình thường bằng cách <strong>nhập mã phòng</strong> hoặc <strong>nhấn vào link chia sẻ</strong>.
                      </p>
                    ) : (
                      <p>
                        <strong className="text-teal-800">Đã phân phối:</strong> Đề thi sẽ <strong>tự động xuất hiện trên trang chủ</strong> của học sinh thuộc lớp <strong className="text-teal-900">{settings.assignedClasses?.join(", ") || "(chưa chọn)"}</strong> hoặc có email trong danh sách giao bài (không cần nhập mã).
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t theme-border">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(2)}
                  leftIcon={<ArrowLeft className="h-4 w-4" />}
                >
                  Quay lại Xem trước
                </Button>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <Button
                    variant="outline"
                    onClick={() => handleSaveQuiz("draft")}
                    className="flex-1 sm:flex-none"
                  >
                    Lưu bản nháp
                  </Button>

                  <Button
                    variant="primary"
                    onClick={() => handleSaveQuiz("published")}
                    disabled={requiresSourceReview && !sourceReviewed}
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                    className="flex-1 sm:flex-none font-bold"
                  >
                    {isEditing ? "Cập nhật & Xuất bản" : "Xuất bản bài thi ngay"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default CreateQuiz;
