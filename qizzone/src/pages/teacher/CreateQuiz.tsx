import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { MathRenderer } from "@/components/common/MathRenderer";
import { useToast } from "@/hooks/useToast";
import type { OptionId, Question, QuizSettings } from "@/types/quiz";

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

export function CreateQuiz() {
  const navigate = useNavigate();
  const { quizId } = useParams();
  const user = useAuthStore((state) => state.user);
  const { createQuiz, updateQuiz, getQuizById } = useQuizStore();
  const toast = useToast();

  const isEditing = !!quizId;
  const existingQuiz = quizId ? getQuizById(quizId) : undefined;

  // 3-Step Wizard: 1. Soạn câu hỏi -> 2. Xem trước -> 3. Cấu hình phòng thi
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [title, setTitle] = useState(
    existingQuiz?.title || "Đề kiểm tra trắc nghiệm"
  );
  const [subjectPreset, setSubjectPreset] = useState<string>(() => {
    if (!existingQuiz) return "Toán học 12";
    return POPULAR_SUBJECTS.includes(existingQuiz.subject)
      ? existingQuiz.subject
      : "custom";
  });
  const [customSubject, setCustomSubject] = useState<string>(() => {
    if (!existingQuiz) return "";
    return POPULAR_SUBJECTS.includes(existingQuiz.subject)
      ? ""
      : existingQuiz.subject;
  });

  const resolvedSubject =
    subjectPreset === "custom" ? customSubject.trim() : subjectPreset;

  const [description, setDescription] = useState(
    existingQuiz?.description || ""
  );

  const [settings, setSettings] = useState<QuizSettings>(
    existingQuiz?.settings || {
      durationMinutes: 45, // 0 = vô thời hạn
      shuffleQuestions: false,
      shuffleOptions: false,
      allowReview: true,
      maxAttempts: 0,
      passPercentage: 50,
    }
  );

  const [questions, setQuestions] = useState<Question[]>(
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

  const hydratedQuizId = useRef<string | null>(null);
  useEffect(() => {
    if (!existingQuiz || hydratedQuizId.current === existingQuiz.id) return;
    hydratedQuizId.current = existingQuiz.id;
    setTitle(existingQuiz.title);
    setSubjectPreset(POPULAR_SUBJECTS.includes(existingQuiz.subject) ? existingQuiz.subject : "custom");
    setCustomSubject(POPULAR_SUBJECTS.includes(existingQuiz.subject) ? "" : existingQuiz.subject);
    setDescription(existingQuiz.description || "");
    setSettings(existingQuiz.settings);
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
      correctAnswers: ["A"],
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

    // Check questions validity
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.content.trim()) {
        toast.error(`Nội dung câu hỏi số ${i + 1} không được để trống`);
        setCurrentStep(1);
        return;
      }
      if (!q.correctAnswers || q.correctAnswers.length === 0) {
        toast.error(`Vui lòng chọn đáp án đúng cho câu hỏi ${i + 1}`);
        setCurrentStep(1);
        return;
      }
    }

    try {
      if (isEditing && quizId) {
        await updateQuiz(quizId, {
        title: title.trim(),
        subject: resolvedSubject,
        description: description.trim(),
        settings,
        questions,
        status,
        });
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
        questions,
        totalQuestions: questions.length,
        totalPoints: questions.reduce((sum, q) => sum + (q.points || 1), 0),
        });

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

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-200/80 pb-5">
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
            leftIcon={<CheckCircle2 className="h-4 w-4" />}
          >
            {isEditing ? "Cập nhật & Xuất bản" : "Xuất bản đề thi"}
          </Button>
        </div>
      </div>

      {/* 3-Step Wizard Navigation Tabs */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-neutral-200 bg-neutral-100 p-1 text-xs font-semibold sm:text-sm">
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl transition cursor-pointer ${
            currentStep === 1
              ? "bg-white text-indigo-700 shadow-xs font-bold"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] text-indigo-700 font-mono font-bold">
            1
          </span>
          <span className="truncate">1. Soạn câu hỏi ({questions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentStep(2)}
          className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl transition cursor-pointer ${
            currentStep === 2
              ? "bg-white text-indigo-700 shadow-xs font-bold"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] text-indigo-700 font-mono font-bold">
            2
          </span>
          <span className="truncate">2. Xem trước đề thi</span>
        </button>

        <button
          type="button"
          onClick={() => setCurrentStep(3)}
          className={`flex items-center justify-center gap-2 py-3 px-2 rounded-xl transition cursor-pointer ${
            currentStep === 3
              ? "bg-white text-indigo-700 shadow-xs font-bold"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] text-indigo-700 font-mono font-bold">
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
            <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
              <FileQuestion className="h-5 w-5 text-indigo-600" />
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
                className="border-neutral-200/90 shadow-xs"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-3 bg-neutral-50/50">
                  <div className="flex items-center gap-2">
                    <Badge variant="primary" size="md">
                      Câu {qIdx + 1}
                    </Badge>
                    <span className="text-xs text-neutral-400">
                      (Điểm: {question.points || 1} đ)
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

                  {/* 4 Options */}
                  <div className="space-y-3 pt-2">
                    <p className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
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
                                : "border-neutral-200 bg-white"
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
                                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
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
            <CardHeader className="bg-neutral-50">
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

                <div className="flex shrink-0 items-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-xs font-medium text-neutral-600">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-indigo-300" />
                    <span>
                      {settings.durationMinutes === 0
                        ? "Vô thời hạn"
                        : `${settings.durationMinutes} phút`}
                    </span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4 text-indigo-300" />
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
                    className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-sm font-semibold text-neutral-900 flex items-start gap-2">
                        <span className="font-bold text-indigo-600 shrink-0">
                          Câu {idx + 1}:
                        </span>
                        <div className="flex-1">
                          <MathRenderer content={q.content} />
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
                                : "border-neutral-200 bg-neutral-50/50 text-neutral-800"
                            }`}
                          >
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-bold text-xs ${
                                isCorrect
                                  ? "bg-emerald-600 text-white"
                                  : "bg-neutral-200 text-neutral-700"
                              }`}
                            >
                              {opt.id}
                            </span>
                            <div className="flex-1 min-w-0">
                              <MathRenderer content={opt.content} />
                            </div>
                            {isCorrect && (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 ml-auto" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {q.explanation && (
                      <div className="rounded-lg bg-indigo-50/60 p-3 border border-indigo-100 text-xs text-indigo-950">
                        <strong className="text-indigo-900">
                          Lời giải chi tiết:{" "}
                        </strong>
                        <MathRenderer content={q.explanation} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-neutral-200">
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
                <Settings className="h-5 w-5 text-indigo-600" />
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
                  <label className="text-sm font-semibold text-neutral-800 select-none">
                    Môn học / Khối lớp *
                  </label>

                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-neutral-400">
                      <BookOpen className="h-4 w-4" />
                    </div>

                    <select
                      value={subjectPreset}
                      onChange={(e) => setSubjectPreset(e.target.value)}
                      className="h-10 w-full appearance-none rounded-xl border border-neutral-300 bg-white px-3.5 pl-10 pr-9 text-sm text-neutral-900 shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-600 cursor-pointer"
                    >
                      {POPULAR_SUBJECTS.map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                      <option value="custom">-- Môn khác (Tự nhập tay) --</option>
                    </select>

                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-400">
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
                    <p className="text-[11px] font-medium text-neutral-500">
                      * Nhập <span className="font-mono font-bold text-indigo-600">"0"</span>: Không giới hạn làm bài
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

              {/* Quy chế phòng thi & Bảo mật */}
              <div className="space-y-4 pt-3 border-t border-neutral-100">
                <p className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                  Quy chế phòng thi & Bảo mật:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition">
                    <input
                      type="checkbox"
                      checked={settings.shuffleQuestions}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          shuffleQuestions: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">
                        Đảo thứ tự câu hỏi
                      </p>
                      <p className="text-xs text-neutral-500">
                        Mỗi học sinh sẽ nhận được thứ tự câu hỏi ngẫu nhiên.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition">
                    <input
                      type="checkbox"
                      checked={settings.shuffleOptions}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          shuffleOptions: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">
                        Đảo thứ tự đáp án (A, B, C, D)
                      </p>
                      <p className="text-xs text-neutral-500">
                        Xáo trộn các lựa chọn để chống nhìn bài.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition">
                    <input
                      type="checkbox"
                      checked={settings.allowReview}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          allowReview: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded-sm text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <p className="text-sm font-semibold text-neutral-900">
                        Cho xem lại lời giải chi tiết
                      </p>
                      <p className="text-xs text-neutral-500">
                        Hiển thị đáp án đúng và lời giải sau khi nộp bài.
                      </p>
                    </div>
                  </label>

                  <div className="rounded-xl border border-neutral-200 p-4 space-y-2">
                    <p className="text-sm font-semibold text-neutral-900">
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
                        className="flex-1 accent-indigo-600 cursor-pointer"
                      />
                      <span className="font-mono font-bold text-sm text-indigo-700 w-12 text-right">
                        {settings.passPercentage}%
                      </span>
                    </div>
                  </div>

                  {/* Số lần làm bài tối đa */}
                  <div className="rounded-xl border border-neutral-200 p-4 space-y-2.5 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">
                          Số lần làm bài tối đa:
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          Nhập <span className="font-mono font-bold text-indigo-600">"0"</span> để cho phép học sinh làm bài vô hạn số lần (không giới hạn).
                        </p>
                      </div>

                      {settings.maxAttempts === 0 ? (
                        <Badge variant="success" size="md" dot>
                          Làm bài vô hạn (Không giới hạn)
                        </Badge>
                      ) : (
                        <Badge variant="primary" size="md">
                          Tối đa {settings.maxAttempts} lượt làm
                        </Badge>
                      )}
                    </div>

                    <div className="max-w-xs pt-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="0 (Vô hạn) hoặc 1, 2, 3..."
                        value={settings.maxAttempts}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setSettings((prev) => ({
                            ...prev,
                            maxAttempts: isNaN(val) || val < 0 ? 0 : val,
                          }));
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-neutral-200">
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
