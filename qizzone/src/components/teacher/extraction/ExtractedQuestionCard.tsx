import { useState } from "react";
import {
  CheckCircle2,
  Trash2,
  Edit2,
  AlertTriangle,
  HelpCircle,
  Bookmark,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MathRenderer } from "@/components/common/MathRenderer";
import { useExtractionStore } from "@/store/extractionStore";
import type { ExtractedQuestion, DetectionStrategy } from "@/types/extractor";
import type { OptionId } from "@/types/quiz";

interface Props {
  question: ExtractedQuestion;
  isSelected?: boolean;
}

export function ExtractedQuestionCard({ question, isSelected }: Props) {
  const {
    setSelectedQuestionId,
    setCorrectAnswer,
    updateQuestion,
    deleteQuestion,
  } = useExtractionStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState(question.content);
  const [editExplanation, setEditExplanation] = useState(
    question.explanation || ""
  );

  const getStrategyBadge = (strategy: DetectionStrategy) => {
    switch (strategy) {
      case "answer_table":
        return {
          label: "Bảng đáp án cuối",
          color: "bg-blue-100 text-blue-800 border-blue-200",
        };
      case "special_marker":
        return {
          label: "Ký hiệu tiền tố (*)",
          color: "bg-emerald-100 text-emerald-800 border-emerald-200",
        };
      case "underline":
        return {
          label: "Gạch chân <u>",
          color: "bg-indigo-100 text-indigo-800 border-indigo-200",
        };
      case "highlight_color":
        return {
          label: "Tô màu / Chữ đỏ",
          color: "bg-amber-100 text-amber-800 border-amber-200",
        };
      case "distinct_bold":
        return {
          label: "In đậm duy nhất <b>",
          color: "bg-purple-100 text-purple-800 border-purple-200",
        };
      case "explanation_text":
        return {
          label: "Trích từ lời giải",
          color: "bg-teal-100 text-teal-800 border-teal-200",
        };
      case "ai_inference":
        return {
          label: "AI Gợi ý tự giải",
          color: "bg-violet-100 text-violet-800 border-violet-200",
        };
      case "manual":
      default:
        return {
          label: "Đã sửa thủ công",
          color: "bg-neutral-100 text-neutral-800 border-neutral-200",
        };
    }
  };

  const badgeInfo = getStrategyBadge(question.detectionStrategy);

  const handleSaveEdit = () => {
    updateQuestion(question.id, {
      content: editPrompt,
      explanation: editExplanation.trim() || undefined,
    });
    setIsEditing(false);
  };

  return (
    <div
      onClick={() => setSelectedQuestionId(question.id)}
      className={`rounded-2xl border transition-all cursor-pointer ${
        isSelected
          ? "border-indigo-600 ring-2 ring-indigo-500/20 bg-white shadow-md"
          : "border-neutral-200/90 bg-white hover:border-neutral-300 shadow-2xs"
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-2 bg-neutral-50/50 rounded-t-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" size="md" className="font-bold">
            Câu {question.order}
          </Badge>

          {/* Detection Strategy / Unanswered Badge */}
          {question.correctAnswers && question.correctAnswers.length > 0 ? (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeInfo.color}`}
            >
              <Bookmark className="h-3 w-3" />
              <span>{badgeInfo.label}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-rose-100 text-rose-800 border-rose-200">
              <AlertTriangle className="h-3 w-3 text-rose-600" />
              <span>Chưa có đáp án</span>
            </span>
          )}

          {/* Confidence Badge */}
          {question.confidenceScore > 0 && (
            <span className="text-[11px] font-mono font-semibold text-neutral-500">
              Tin cậy: {Math.round(question.confidenceScore * 100)}%
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Points input */}
          <div className="flex items-center gap-1 text-xs font-semibold text-neutral-600 bg-white px-2 py-1 rounded-lg border border-neutral-200">
            <span>Điểm:</span>
            <input
              type="number"
              step={0.25}
              min={0}
              max={10}
              value={question.points}
              onChange={(e) =>
                updateQuestion(question.id, {
                  points: parseFloat(e.target.value) || 0,
                })
              }
              onClick={(e) => e.stopPropagation()}
              className="w-12 font-mono font-bold text-center text-neutral-900 bg-transparent focus:outline-hidden"
            />
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(!isEditing);
            }}
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-200 transition cursor-pointer"
            title="Chỉnh sửa nội dung"
          >
            <Edit2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteQuestion(question.id);
            }}
            className="p-1.5 rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600 transition cursor-pointer"
            title="Xóa câu hỏi này"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Warnings bar */}
      {question.warningFlags && question.warningFlags.length > 0 && (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-100 flex items-center gap-2 text-xs font-medium text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span>{question.warningFlags.join(" · ")}</span>
        </div>
      )}

      {/* Body */}
      <div className="p-5 space-y-4">
        {isEditing ? (
          <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Nội dung câu hỏi (hỗ trợ $...$ LaTeX):
              </label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={3}
                className="w-full text-sm rounded-xl border border-neutral-300 p-3 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Lời giải chi tiết:
              </label>
              <textarea
                value={editExplanation}
                onChange={(e) => setEditExplanation(e.target.value)}
                rows={2}
                placeholder="Nhập hướng dẫn giải..."
                className="w-full text-xs rounded-xl border border-neutral-300 p-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveEdit}
                leftIcon={<Check className="h-4 w-4" />}
              >
                Lưu câu hỏi
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-base text-neutral-900 leading-relaxed font-medium">
            <MathRenderer content={question.content} />
          </div>
        )}

        {/* Options Grid */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
            <span>Các lựa chọn (Click để chọn đáp án đúng):</span>
            {question.correctAnswers && question.correctAnswers.length > 0 ? (
              <span className="text-emerald-700 font-bold">
                Đáp án chọn: {question.correctAnswers.join(", ")}
              </span>
            ) : (
              <span className="text-rose-600 font-bold flex items-center gap-1">
                <span>⚠️ Chưa chọn đáp án</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {question.options.map((opt) => {
              const isCorrect = question.correctAnswers.includes(opt.id);

              return (
                <div
                  key={opt.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCorrectAnswer(question.id, opt.id as OptionId);
                  }}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-sm transition cursor-pointer select-none ${
                    isCorrect
                      ? "border-emerald-500 bg-emerald-50/90 text-emerald-950 ring-2 ring-emerald-500/30 font-semibold"
                      : "border-neutral-200 bg-neutral-50/40 text-neutral-800 hover:border-indigo-300 hover:bg-white"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-mono font-bold mt-0.5 ${
                      isCorrect
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {opt.id}
                  </span>

                  <div className="flex-1 min-w-0 pt-0.5">
                    <MathRenderer content={opt.content} />
                  </div>

                  {isCorrect && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 ml-auto shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Đúng</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Explanation Box */}
        {question.explanation && !isEditing && (
          <div className="rounded-xl bg-indigo-50/70 p-3.5 border border-indigo-100 text-xs text-indigo-950 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-indigo-900">
              <HelpCircle className="h-3.5 w-3.5 text-indigo-600" />
              <span>Phương pháp & Lời giải:</span>
            </div>
            <div className="leading-relaxed">
              <MathRenderer content={question.explanation} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExtractedQuestionCard;
