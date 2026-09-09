import { useState } from "react";
import { AlertTriangle, CheckCircle2, Flag, Send, ArrowLeft, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface SubmitConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalQuestions: number;
  answeredCount: number;
  flaggedCount: number;
  isLoading?: boolean;
}

export function SubmitConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  totalQuestions,
  answeredCount,
  flaggedCount,
  isLoading = false,
}: SubmitConfirmModalProps) {
  const unansweredCount = Math.max(0, totalQuestions - answeredCount);
  const hasUnanswered = unansweredCount > 0;

  // Secondary confirmation step when questions are unanswered
  const [isSecondConfirm, setIsSecondConfirm] = useState(false);

  const handleClose = () => {
    setIsSecondConfirm(false);
    onClose();
  };

  const handleFirstSubmitClick = () => {
    if (hasUnanswered) {
      setIsSecondConfirm(true);
    } else {
      onConfirm();
    }
  };

  const handleConfirmFinal = () => {
    setIsSecondConfirm(false);
    onConfirm();
  };

  if (isSecondConfirm) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={isLoading ? () => {} : handleClose}
        title="⚠️ Cảnh báo xác nhận nộp bài lần 2"
        description="Bạn vẫn còn câu hỏi chưa hoàn thành trong bài thi."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setIsSecondConfirm(false)}
              disabled={isLoading}
              leftIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Quay lại làm bài tiếp
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmFinal}
              isLoading={isLoading}
              leftIcon={<AlertTriangle className="h-4 w-4" />}
            >
              {isLoading ? "Đang chấm điểm..." : "Vẫn muốn nộp bài (0đ câu trống)"}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-center text-rose-950">
            <div className="mb-1 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h4 className="font-extrabold text-base text-rose-900">
              Bạn còn {unansweredCount} câu hỏi chưa trả lời!
            </h4>
            <p className="text-xs text-rose-800 leading-relaxed">
              Các câu hỏi chưa làm sẽ tự động bị tính <strong>0 điểm</strong> và không thể thay đổi sau khi nộp.
            </p>
          </div>

          <div className="rounded-xl bg-neutral-50 p-3 border border-neutral-200 text-xs text-neutral-600 text-center">
            Khuyến khích: Bạn nên quay lại kiểm tra và chọn hết tất cả các câu trước khi hoàn tất nộp bài.
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={isLoading ? () => {} : handleClose}
      title="Xác nhận nộp bài thi"
      description="Vui lòng kiểm tra lại tiến độ làm bài trước khi hoàn tất nộp bài."
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Tiếp tục làm bài
          </Button>
          <Button
            variant="primary"
            onClick={handleFirstSubmitClick}
            isLoading={isLoading}
            leftIcon={<Send className="h-4 w-4" />}
          >
            {isLoading ? "Đang chấm điểm..." : "Nộp bài ngay"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {/* Progress Stats Summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-100">
            <div className="flex items-center justify-center gap-1 text-emerald-600 mb-1">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-semibold">Đã làm</span>
            </div>
            <p className="text-xl font-extrabold text-emerald-900 font-mono">
              {answeredCount}/{totalQuestions}
            </p>
          </div>

          <div
            className={`rounded-xl p-3 border ${
              hasUnanswered
                ? "bg-rose-50 border-rose-100 text-rose-900"
                : "bg-neutral-50 border-neutral-200 text-neutral-600"
            }`}
          >
            <div className="flex items-center justify-center gap-1 text-rose-600 mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-semibold">Chưa làm</span>
            </div>
            <p className="text-xl font-extrabold font-mono text-rose-700">
              {unansweredCount}
            </p>
          </div>

          <div className="rounded-xl bg-amber-50 p-3 border border-amber-100">
            <div className="flex items-center justify-center gap-1 text-amber-600 mb-1">
              <Flag className="h-4 w-4" />
              <span className="text-xs font-semibold">Đánh dấu</span>
            </div>
            <p className="text-xl font-extrabold text-amber-900 font-mono">
              {flaggedCount}
            </p>
          </div>
        </div>

        {/* Warning Banner if has unanswered */}
        {hasUnanswered ? (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3.5 border border-amber-200 text-amber-900 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-950">
                Bạn vẫn còn {unansweredCount} câu hỏi chưa chọn đáp án!
              </p>
              <p className="text-amber-800 mt-0.5">
                Các câu chưa chọn sẽ không được tính điểm. Bạn có chắc chắn muốn nộp bài lúc này?
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 border border-emerald-200 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>Tuyệt vời! Bạn đã hoàn thành toàn bộ câu hỏi trong đề thi.</span>
          </div>
        )}

        <p className="text-xs text-neutral-500 text-center">
          Sau khi nộp bài, hệ thống sẽ tiến hành chấm điểm tự động và bạn sẽ không thể thay đổi đáp án.
        </p>
      </div>
    </Modal>
  );
}

export default SubmitConfirmModal;
