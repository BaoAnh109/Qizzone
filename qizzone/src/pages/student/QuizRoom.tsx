import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Clock, Send, Flag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/hooks/useToast";

export function QuizRoom() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  const questions = [
    {
      id: 1,
      content: "Cho hàm số f(x) = x³ - 3x + 2. Điểm cực tiểu của hàm số đạt tại:",
      options: [
        { id: "A", text: "x = -1" },
        { id: "B", text: "x = 1" },
        { id: "C", text: "x = 0" },
        { id: "D", text: "x = 2" },
      ],
    },
    {
      id: 2,
      content: "Nguyên hàm của hàm số f(x) = e^(2x) là:",
      options: [
        { id: "A", text: "F(x) = 2e^(2x) + C" },
        { id: "B", text: "F(x) = 1/2 e^(2x) + C" },
        { id: "C", text: "F(x) = e^(2x) + C" },
        { id: "D", text: "F(x) = 1/4 e^(2x) + C" },
      ],
    },
  ];

  const handleSelectOption = (optionId: string) => {
    setSelectedAnswers((prev) => ({
      ...prev,
      [currentQuestion]: optionId,
    }));
    toast.info("Đã lưu câu trả lời vào bộ nhớ tạm", "Auto-Save");
  };

  const handleConfirmSubmit = () => {
    setIsSubmitModalOpen(false);
    toast.success("Nộp bài thi thành công!", "Hoàn tất");
    navigate(`/student/result/res-${quizId || "demo"}`);
  };

  const answeredCount = Object.keys(selectedAnswers).length;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Quiz Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-neutral-200 shadow-xs">
        <div>
          <span className="text-xs font-semibold text-indigo-600 uppercase">
            Phòng thi #{quizId || "QZ9821"}
          </span>
          <h1 className="text-lg font-bold text-neutral-900">
            Kiểm tra Giải tích 12: Đạo hàm & Nguyên hàm
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-indigo-900 border border-indigo-200">
            <Clock className="h-4 w-4 text-indigo-600 animate-pulse" />
            <span className="font-mono font-bold text-sm">38:45</span>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsSubmitModalOpen(true)}
            rightIcon={<Send className="h-4 w-4" />}
          >
            Nộp bài ({answeredCount}/{questions.length})
          </Button>
        </div>
      </div>

      {/* Question Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Question Area */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                  Câu hỏi {currentQuestion + 1} / {questions.length}
                </span>
                <Button variant="ghost" size="sm" leftIcon={<Flag className="h-3.5 w-3.5" />}>
                  Đánh dấu xem lại
                </Button>
              </div>
              <CardTitle className="text-base sm:text-lg mt-2">
                {questions[currentQuestion].content}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {questions[currentQuestion].options.map((opt) => {
                const isSelected = selectedAnswers[currentQuestion] === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectOption(opt.id)}
                    className={`w-full flex items-center gap-3 rounded-xl border p-4 text-left transition cursor-pointer ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-medium shadow-xs"
                        : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 text-neutral-800"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-bold text-xs ${
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-neutral-300 bg-white text-neutral-600"
                      }`}
                    >
                      {opt.id}
                    </div>
                    <span className="text-sm flex-1">{opt.text}</span>
                  </button>
                );
              })}

              <div className="flex items-center justify-between pt-4 border-t border-neutral-100 mt-6">
                <Button
                  variant="outline"
                  disabled={currentQuestion === 0}
                  onClick={() => setCurrentQuestion((prev) => Math.max(0, prev - 1))}
                >
                  Câu trước
                </Button>

                <Button
                  variant="primary"
                  disabled={currentQuestion === questions.length - 1}
                  onClick={() =>
                    setCurrentQuestion((prev) => Math.min(questions.length - 1, prev + 1))
                  }
                >
                  Câu tiếp theo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Question Grid Navigator */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Bảng câu hỏi</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {questions.map((_, idx) => {
                  const isAnswered = selectedAnswers[idx] !== undefined;
                  const isCurrent = currentQuestion === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCurrentQuestion(idx)}
                      className={`h-10 rounded-lg text-xs font-bold transition cursor-pointer border ${
                        isCurrent
                          ? "ring-2 ring-indigo-600 ring-offset-1 border-indigo-600"
                          : ""
                      } ${
                        isAnswered
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200"
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Submit Confirmation Modal */}
      <Modal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        title="Xác nhận nộp bài thi"
        description="Kiểm tra lại tiến độ làm bài trước khi hoàn tất."
        footer={
          <>
            <Button variant="outline" onClick={() => setIsSubmitModalOpen(false)}>
              Làm tiếp
            </Button>
            <Button variant="primary" onClick={handleConfirmSubmit}>
              Xác nhận nộp bài
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-neutral-600">
          <p>
            Bạn đã hoàn thành <strong>{answeredCount}</strong> / <strong>{questions.length}</strong> câu hỏi.
          </p>
          {answeredCount < questions.length && (
            <p className="text-rose-600 text-xs font-medium">
              Lưu ý: Bạn còn {questions.length - answeredCount} câu hỏi chưa chọn đáp án!
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default QuizRoom;
