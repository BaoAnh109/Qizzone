import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug, Send } from "lucide-react";
import {
  createBugReportSchema,
  type BugReport,
  type BugReportCategory,
  type BugReportSeverity,
} from "@qizzone/domain";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { bugReportService } from "@/services/bugReportService";
import { useAuthStore } from "@/store/authStore";
import { useToast } from "@/hooks/useToast";

export interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPageRoute?: string;
  onCreated?: (report: BugReport) => void;
}

const CATEGORY_OPTIONS: Array<{ value: BugReportCategory; label: string }> = [
  { value: "general", label: "Chung" },
  { value: "exam", label: "Phòng thi / Đề thi" },
  { value: "classroom", label: "Lớp học" },
  { value: "account", label: "Tài khoản / Phân quyền" },
  { value: "notification", label: "Thông báo" },
  { value: "ui", label: "Giao diện" },
  { value: "performance", label: "Hiệu năng / Tốc độ" },
];

const SEVERITY_OPTIONS: Array<{ value: BugReportSeverity; label: string }> = [
  { value: "low", label: "Thấp" },
  { value: "medium", label: "Trung bình" },
  { value: "high", label: "Cao" },
  { value: "critical", label: "Nghiêm trọng" },
];

function roleLabel(role?: string): string {
  if (role === "admin") return "Quản trị";
  if (role === "teacher") return "Giáo viên";
  return "Học sinh";
}

export function BugReportModal({
  isOpen,
  onClose,
  defaultPageRoute,
  onCreated,
}: BugReportModalProps) {
  const location = useLocation();
  const toast = useToast();
  const user = useAuthStore((state) => state.user);

  const pageRoute = defaultPageRoute ?? `${location.pathname}${location.search}`;

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<BugReportCategory>("general");
  const [severity, setSeverity] = useState<BugReportSeverity>("medium");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; description?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setTitle("");
    setCategory("general");
    setSeverity("medium");
    setDescription("");
    setFieldErrors({});
    setSubmitError(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setFieldErrors({});
    setSubmitError(null);
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const parsed = createBugReportSchema.safeParse({
      title,
      description,
      category,
      severity,
      pageRoute,
      contextMetadata: {
        role: user?.role ?? "student",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
        viewport:
          typeof window !== "undefined"
            ? `${window.innerWidth}x${window.innerHeight}`
            : "unknown",
      },
    });

    if (!parsed.success) {
      const nextErrors: { title?: string; description?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "title" && !nextErrors.title) {
          nextErrors.title = issue.message;
        }
        if (issue.path[0] === "description" && !nextErrors.description) {
          nextErrors.description = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await bugReportService.createReport(parsed.data);
      toast.success("Đã gửi phiếu báo lỗi tới quản trị viên.");
      onCreated?.(created);
      resetForm();
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể gửi báo lỗi. Vui lòng thử lại.";
      setSubmitError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-amber-600" aria-hidden="true" />
          <span>Báo lỗi hệ thống</span>
        </span>
      }
      description="Mô tả sự cố bạn gặp phải để quản trị viên tiếp nhận và phản hồi."
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
        <Input
          id="bug-report-title"
          label="Tiêu đề lỗi *"
          placeholder="VD: Không tải được danh sách câu hỏi khi nộp bài"
          maxLength={200}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (fieldErrors.title) {
              setFieldErrors((prev) => ({ ...prev, title: undefined }));
            }
          }}
          error={fieldErrors.title}
          helperText="Ngắn gọn, rõ ràng (3–200 ký tự)."
          disabled={isSubmitting}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 text-left">
            <label
              htmlFor="bug-category"
              className="block text-sm font-medium theme-text-secondary select-none"
            >
              Phân loại
            </label>
            <select
              id="bug-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as BugReportCategory)}
              disabled={isSubmitting}
              className="theme-control min-h-11 w-full rounded-lg border px-3 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 text-left">
            <label
              htmlFor="bug-severity"
              className="block text-sm font-medium theme-text-secondary select-none"
            >
              Mức độ nghiêm trọng
            </label>
            <select
              id="bug-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as BugReportSeverity)}
              disabled={isSubmitting}
              className="theme-control min-h-11 w-full rounded-lg border px-3 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              {SEVERITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Textarea
          id="bug-report-description"
          label="Mô tả chi tiết *"
          placeholder="Mô tả các bước thực hiện, kết quả mong muốn và lỗi thực tế..."
          rows={5}
          maxLength={5000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (fieldErrors.description) {
              setFieldErrors((prev) => ({ ...prev, description: undefined }));
            }
          }}
          error={fieldErrors.description}
          helperText="Nêu các bước thực hiện, kết quả mong muốn và lỗi thực tế (10–5000 ký tự)."
          disabled={isSubmitting}
        />

        <div className="rounded-lg border theme-border theme-surface-muted p-3 text-xs space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="theme-text-muted">Vai trò hiện tại:</span>
            <strong className="theme-text-primary">{roleLabel(user?.role)}</strong>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="theme-text-muted">Trang gặp lỗi:</span>
            <code className="max-w-full break-all rounded px-1.5 py-0.5 theme-surface border theme-border theme-text-secondary">
              {pageRoute}
            </code>
          </div>
        </div>

        {submitError && (
          <div
            role="alert"
            className="rounded-lg border px-3.5 py-2.5 text-xs font-medium theme-status-danger"
          >
            {submitError}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Hủy
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            leftIcon={<Send className="h-4 w-4" />}
          >
            Gửi báo lỗi
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default BugReportModal;
