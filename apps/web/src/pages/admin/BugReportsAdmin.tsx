import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Bug, Clock, RefreshCw, Search, User } from "lucide-react";
import {
  formatVietnamDateTime,
  type BugReport,
  type BugReportSeverity,
  type BugReportStatus,
} from "@qizzone/domain";
import { bugReportService } from "@/services/bugReportService";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | BugReportStatus;
type RoleFilter = "all" | "student" | "teacher";
type SeverityFilter = "all" | BugReportSeverity;

const STATUS_META: Record<BugReportStatus, { label: string; variant: BadgeVariant }> = {
  new: { label: "Mới", variant: "primary" },
  in_progress: { label: "Đang xử lý", variant: "warning" },
  resolved: { label: "Đã giải quyết", variant: "success" },
};

const SEVERITY_META: Record<BugReportSeverity, { label: string; variant: BadgeVariant }> = {
  low: { label: "Thấp", variant: "default" },
  medium: { label: "Trung bình", variant: "primary" },
  high: { label: "Cao", variant: "warning" },
  critical: { label: "Nghiêm trọng", variant: "destructive" },
};

const ROLE_LABELS: Record<string, string> = {
  student: "Học sinh",
  teacher: "Giáo viên",
  admin: "Quản trị viên",
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "Chung",
  exam: "Phòng thi / Đề thi",
  classroom: "Lớp học",
  account: "Tài khoản / Phân quyền",
  notification: "Thông báo",
  ui: "Giao diện",
  performance: "Hiệu năng / Tốc độ",
};

const selectClass =
  "h-10 rounded-lg border theme-border theme-surface px-3 text-sm theme-text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary";

interface TriageCardProps {
  report: BugReport;
  highlighted: boolean;
  onSaved: (report: BugReport) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}

function TriageCard({ report, highlighted, onSaved, cardRef }: TriageCardProps) {
  const toast = useToast();
  const [status, setStatus] = useState<BugReportStatus>(report.status);
  const [response, setResponse] = useState(report.adminResponse ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const statusInfo = STATUS_META[report.status] ?? STATUS_META.new;
  const severityInfo = SEVERITY_META[report.severity] ?? SEVERITY_META.medium;
  const dirty = status !== report.status || response.trim() !== (report.adminResponse ?? "").trim();
  const fieldId = `bug-${report.id}`;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await bugReportService.updateStatus({
        reportId: report.id,
        status,
        adminResponse: response.trim() ? response.trim() : null,
      });
      onSaved(updated);
      toast.success("Đã cập nhật phiếu báo lỗi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thể cập nhật phiếu báo lỗi.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={cardRef}>
      <Card className={cn("transition-shadow duration-150", highlighted && "theme-target-highlight")}>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusInfo.variant} size="sm" dot>
                  {statusInfo.label}
                </Badge>
                <Badge variant={severityInfo.variant} size="sm">
                  Mức độ: {severityInfo.label}
                </Badge>
                <Badge variant="outline" size="sm">
                  {CATEGORY_LABELS[report.category] || report.category}
                </Badge>
                {highlighted && (
                  <Badge variant="primary" size="sm">
                    Được mở từ thông báo
                  </Badge>
                )}
              </div>
              <h2 className="text-base font-bold theme-text-primary break-words">{report.title}</h2>
              <p className="flex flex-wrap items-center gap-1.5 text-xs theme-text-muted">
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-medium theme-text-secondary">
                  {report.reporterName || report.reporterEmail || "Người dùng"}
                </span>
                {report.reporterEmail && <span>({report.reporterEmail})</span>}
                <span>· {ROLE_LABELS[report.reporterRole] ?? report.reporterRole}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs theme-text-muted shrink-0">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{formatVietnamDateTime(report.createdAt)}</span>
            </div>
          </div>

          <p className="whitespace-pre-wrap text-sm leading-6 theme-text-secondary">{report.description}</p>

          {report.pageRoute && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs theme-text-muted">
              <span>Trang ghi nhận:</span>
              <code className="break-all rounded px-2 py-0.5 theme-surface-muted border theme-border theme-text-secondary">
                {report.pageRoute}
              </code>
            </div>
          )}

          <div className="grid gap-3 rounded-xl border theme-border theme-surface-muted p-4 sm:grid-cols-[200px_1fr]">
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-status`} className="text-xs font-semibold theme-text-secondary">
                Trạng thái xử lý
              </label>
              <select
                id={`${fieldId}-status`}
                className={cn(selectClass, "w-full")}
                value={status}
                onChange={(e) => setStatus(e.target.value as BugReportStatus)}
              >
                <option value="new">Mới</option>
                <option value="in_progress">Đang xử lý</option>
                <option value="resolved">Đã giải quyết</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-response`} className="text-xs font-semibold theme-text-secondary">
                Phản hồi cho người báo lỗi
              </label>
              <Textarea
                id={`${fieldId}-response`}
                rows={3}
                maxLength={5000}
                placeholder="Nhập phản hồi, hướng dẫn hoặc kết quả xử lý..."
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button size="sm" onClick={() => void handleSave()} isLoading={isSaving} disabled={!dirty}>
                Lưu cập nhật
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function BugReportsAdmin() {
  const toast = useToast();
  const toastRef = useRef(toast);
  const [searchParams] = useSearchParams();
  const highlightedReportId = searchParams.get("reportId");
  const [reports, setReports] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await bugReportService.listReports();
      setReports(Array.isArray(data) ? data : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tải danh sách báo lỗi.";
      setLoadError(message);
      toastRef.current.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!highlightedReportId) return;
    const el = cardRefs.current.get(highlightedReportId);
    if (el && typeof el.scrollIntoView === "function") {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
  }, [highlightedReportId, reports]);

  const counts = useMemo(
    () => ({
      all: reports.length,
      new: reports.filter((r) => r.status === "new").length,
      in_progress: reports.filter((r) => r.status === "in_progress").length,
      resolved: reports.filter((r) => r.status === "resolved").length,
    }),
    [reports],
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return reports.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (roleFilter !== "all" && r.reporterRole !== roleFilter) return false;
      if (severityFilter !== "all" && r.severity !== severityFilter) return false;
      if (!q) return true;
      return [r.title, r.description, r.reporterEmail, r.reporterName, r.adminResponse]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [reports, statusFilter, roleFilter, severityFilter, searchTerm]);

  const tabs: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "Tất cả", count: counts.all },
    { id: "new", label: "Mới", count: counts.new },
    { id: "in_progress", label: "Đang xử lý", count: counts.in_progress },
    { id: "resolved", label: "Đã giải quyết", count: counts.resolved },
  ];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-heading">Quản lý báo lỗi</h1>
          <p className="page-description">
            Tiếp nhận, phân loại và phản hồi các phiếu báo lỗi từ giáo viên và học sinh.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          Làm mới
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lọc theo trạng thái">
          {tabs.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(tab.id)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "theme-nav-active border-[var(--status-info-border)]"
                    : "theme-surface theme-border theme-text-secondary theme-hover-surface",
                )}
              >
                <span>{tab.label}</span>
                <span className="rounded-full px-1.5 py-0.5 text-[11px] theme-surface-muted theme-text-primary">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:flex-1">
            <Input
              aria-label="Tìm kiếm phiếu báo lỗi"
              placeholder="Tìm theo tiêu đề, mô tả, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
            />
          </div>
          <label className="sr-only" htmlFor="bug-role-filter">
            Vai trò người báo lỗi
          </label>
          <select
            id="bug-role-filter"
            className={selectClass}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          >
            <option value="all">Mọi vai trò</option>
            <option value="student">Học sinh</option>
            <option value="teacher">Giáo viên</option>
          </select>
          <label className="sr-only" htmlFor="bug-severity-filter">
            Mức độ
          </label>
          <select
            id="bug-severity-filter"
            className={selectClass}
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
          >
            <option value="all">Mọi mức độ</option>
            <option value="critical">Nghiêm trọng</option>
            <option value="high">Cao</option>
            <option value="medium">Trung bình</option>
            <option value="low">Thấp</option>
          </select>
        </div>
      </div>

      {isLoading && reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm theme-text-muted">
            Đang tải danh sách báo lỗi...
          </CardContent>
        </Card>
      ) : loadError ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <AlertCircle className="mx-auto h-8 w-8 text-status-danger" aria-hidden="true" />
            <p className="text-sm font-medium theme-text-primary">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Thử lại
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <Bug className="mx-auto h-10 w-10 theme-text-muted opacity-60" aria-hidden="true" />
            <h2 className="text-base font-semibold theme-text-primary">
              {reports.length === 0 ? "Chưa có phiếu báo lỗi nào" : "Không tìm thấy phiếu báo lỗi phù hợp"}
            </h2>
            <p className="text-xs theme-text-muted">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((report) => (
            <TriageCard
              key={`${report.id}-${report.updatedAt}`}
              report={report}
              highlighted={highlightedReportId === report.id}
              cardRef={(el) => {
                if (el) cardRefs.current.set(report.id, el);
                else cardRefs.current.delete(report.id);
              }}
              onSaved={(updated) =>
                setReports((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default BugReportsAdmin;
