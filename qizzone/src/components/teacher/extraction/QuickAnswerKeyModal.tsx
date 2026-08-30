import { useState } from "react";
import { Sparkles, KeyRound } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useExtractionStore } from "@/store/extractionStore";
import { useToast } from "@/hooks/useToast";
import type { OptionId } from "@/types/quiz";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickAnswerKeyModal({ isOpen, onClose }: Props) {
  const { extractionResult, applyBatchAnswerKey, setCorrectAnswer } =
    useExtractionStore();
  const toast = useToast();

  const [inputString, setInputString] = useState("");

  const handleApplyString = () => {
    if (!inputString.trim()) {
      toast.warning("Vui lòng nhập chuỗi bảng đáp án (VD: 1A 2B 3C...)");
      return;
    }

    const { updatedCount } = applyBatchAnswerKey(inputString);
    if (updatedCount > 0) {
      toast.success(`Đã cập nhật đồng loạt đáp án cho ${updatedCount} câu hỏi!`);
      setInputString("");
      onClose();
    } else {
      toast.error("Không tìm thấy cú pháp đáp án hợp lệ trong chuỗi vừa nhập");
    }
  };

  const questions = extractionResult?.questions || [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nhập Nhanh Bảng Đáp Án (Quick Answer Key)"
      description="Dán chuỗi đáp án hoặc click chọn nhanh đáp án A, B, C, D cho toàn bộ danh sách câu hỏi."
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button
            variant="primary"
            onClick={handleApplyString}
            leftIcon={<Sparkles className="h-4 w-4" />}
          >
            Áp dụng chuỗi đáp án
          </Button>
        </div>
      }
    >
      <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1">
        {/* Paste Box */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
            <KeyRound className="h-4 w-4 text-indigo-600" />
            <span>Dán chuỗi bảng đáp án:</span>
          </label>
          <textarea
            value={inputString}
            onChange={(e) => setInputString(e.target.value)}
            rows={3}
            placeholder="Ví dụ: 1A 2B 3C 4D 5A 6B hoặc 1.A, 2.B, 3.C..."
            className="w-full text-xs font-mono rounded-xl border border-neutral-300 p-3 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
          />
          <p className="text-[11px] text-neutral-500">
            Hỗ trợ tự động nhận diện các định dạng: <code className="font-bold text-indigo-600">1A 2B</code>, <code className="font-bold text-indigo-600">1.A 2.B</code>, <code className="font-bold text-indigo-600">1-A, 2-B</code>.
          </p>
        </div>

        {/* Quick Grid Selector */}
        <div className="space-y-3 pt-3 border-t border-neutral-100">
          <label className="text-xs font-bold text-neutral-800 block">
            Hoặc chọn trực tiếp trên ma trận câu hỏi ({questions.length} câu):
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-60 overflow-y-auto p-1 bg-neutral-50 rounded-xl border border-neutral-200">
            {questions.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between p-2 rounded-lg bg-white border border-neutral-200 shadow-2xs text-xs"
              >
                <span className="font-bold font-mono text-neutral-700 w-8">
                  C{q.order}:
                </span>

                <div className="flex items-center gap-1">
                  {(["A", "B", "C", "D"] as const).map((letter) => {
                    const isSelected = q.correctAnswers.includes(letter);
                    return (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => setCorrectAnswer(q.id, letter as OptionId)}
                        className={`h-6 w-6 rounded-md font-mono font-bold text-[11px] transition cursor-pointer ${
                          isSelected
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-neutral-100 text-neutral-600 hover:bg-indigo-50 hover:text-indigo-700"
                        }`}
                      >
                        {letter}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default QuickAnswerKeyModal;
