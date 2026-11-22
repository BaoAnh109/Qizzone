import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Clock,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  formatVietnamDateTime,
  type BugReport,
  type BugReportSeverity,
  type BugReportStatus,
} from "@qizzone/domain";
import { bugReportService } from "@/services/bugReportService";
import { BugReportModal } from "@/components/common/BugReportModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | BugReportStatus;

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

const CATEGORY_LABELS: Record<string, string> = {
  general: "Chung",
  exam: "Phòng thi / Đề thi",
  classroom: "Lớp học",
  account: "Tài khoản / Phân quyền",
  notification: "Thông báo",
  ui: "Giao diện",
  performance: "Hiệu năng / Tốc độ",
};

export function BugReportsPage() {
  const toast = useToast();
  const toastRef = useRef(toast);
  const [searchParams] = useSearchParams();
  const highlightedReportId = searchParams.get("reportId");

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [reports, setReports] = useState<BugReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterSelection, setFilterSelection] = useState<{
    filter: StatusFilter;
    forReportId: string | null;
  }>({ filter: "all", forReportId: highlightedReportId });
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const statusFilter: StatusFilter =
    filterSelection.forReportId === highlightedReportId ? filterSelection.filter : "all";

  const handleSelectFilter = (nextFilter: StatusFilter) => {
    setFilterSelection({ filter: nextFilter, forReportId: highlightedReportId });
  };

  const fetchReports = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await bugReportService.listReports();
      setReports(Array.isArray(data) ? data : []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể tải danh sách báo lỗi.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void bugReportService
      .listReports()
      .then((data) => {
        if (cancelled) return;
        setReports(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Không thể tải danh sách báo lỗi.";
        setLoadError(message);
        toastRef.current.error(message);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!highlightedReportId || reports.length === 0) return;
    const match = reports.find((r) => r.id === highlightedReportId);
    if (!match) return;
    if (statusFilter !== "all" && match.status !== statusFilter) return;
    const targetEl = cardRefs.current.get(highlightedReportId);
    if (targetEl && typeof targetEl.scrollIntoView === "function") {
      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      targetEl.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    }
  }, [highlightedReportId, reports, statusFilter]);

  const counts = useMemo(() => {
    return {
      all: reports.length,
      new: reports.filter((r) => r.status === "new").length,
      in_progress: reports.filter((r) => r.status === "in_progress").length,
      resolved: reports.filter((r) => r.status === "resolved").length,
    };
  }, [reports]);

  const filteredReports = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return reports.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (!q) return true;
      return (
        report.title.toLowerCase().includes(q) ||
        report.description.toLowerCase().includes(q) ||
        (report.adminResponse || "").toLowerCase().includes(q)
      );
    });
  }, [reports, statusFilter, searchTerm]);

  const filterTabs: Array<{ id: StatusFilter; label: string; count: number }> = [
    { id: "all", label: "Tất cả", count: counts.all },
    { id: "new", label: "Mới", count: counts.new },
    { id: "in_progress", label: "Đang xử lý", count: counts.in_progress },
    { id: "resolved", label: "Đã giải quyết", count: counts.resolved },
  ];

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col gap-4 border-b theme-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-heading">Báo lỗi & Hỗ trợ</h1>
          <p className="page-description">
            Gửi phản ánh sự cố tới quản trị viên và theo dõi tiến độ xử lý.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchReports()}
            isLoading={isLoading}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Làm mới
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Gửi báo lỗi mới
          </Button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lọc theo trạng thái">
          {filterTabs.map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => handleSelectFilter(tab.id)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "theme-nav-active border-[var(--status-info-border)]"
                    : "theme-surface theme-border theme-text-secondary theme-hover-surface"
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

        <div className="w-full sm:w-72">
          <Input
            aria-label="Tìm kiếm phiếu báo lỗi"
            placeholder="Tìm tiêu đề, mô tả, phản hồi..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
          />
        </div>
      </div>

      {/* Content */}
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
            <Button variant="outline" size="sm" onClick={() => void fetchReports()}>
              Thử lại
            </Button>
          </CardContent>
        </Card>
      ) : filteredReports.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <Bug className="mx-auto h-10 w-10 theme-text-muted opacity-60" aria-hidden="true" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold theme-text-primary">
                {reports.length === 0
                  ? "Bạn chưa gửi phiếu báo lỗi nào"
                  : "Không tìm thấy phiếu báo lỗi phù hợp"}
              </h2>
              <p className="text-xs theme-text-muted max-w-md mx-auto">
                {reports.length === 0
                  ? "Nếu gặp sự cố trong quá trình sử dụng, nhấn Gửi báo lỗi mới để báo cho quản trị viên."
                  : "Thử thay đổi bộ lọc trạng thái hoặc từ khóa tìm kiếm."}
              </p>
            </div>
            {reports.length === 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsModalOpen(true)}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Gửi báo lỗi mới
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredReports.map((report) => {
            const statusInfo = STATUS_META[report.status] ?? STATUS_META.new;
            const severityInfo = SEVERITY_META[report.severity] ?? SEVERITY_META.medium;
            const isHighlighted = highlightedReportId === report.id;

            return (
              <div
                key={report.id}
                ref={(el) => {
                  if (el) {
                    cardRefs.current.set(report.id, el);
                  } else {
                    cardRefs.current.delete(report.id);
                  }
                }}
              >
                <Card
                  className={cn(
                    "transition-shadow duration-150",
                    isHighlighted && "theme-target-highlight"
                  )}
                >
                <CardContent className="p-5 space-y-3">
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
                        {isHighlighted && (
                          <Badge variant="primary" size="sm">
                            Được mở từ thông báo
                          </Badge>
                        )}
                      </div>
                      <h2 className="text-base font-bold theme-text-primary break-words">
                        {report.title}
                      </h2>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs theme-text-muted shrink-0">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{formatVietnamDateTime(report.createdAt)}</span>
                    </div>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-6 theme-text-secondary">
                    {report.description}
                  </p>

                  {report.pageRoute && (
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs theme-text-muted">
                      <span>Trang ghi nhận:</span>
                      <code className="break-all rounded px-2 py-0.5 theme-surface-muted border theme-border theme-text-secondary">
                        {report.pageRoute}
                      </code>
                    </div>
                  )}

                  {report.adminResponse ? (
                    <div
                      className={cn(
                        "rounded-xl border p-3.5 space-y-1.5",
                        report.status === "resolved"
                          ? "theme-status-success"
                          : "theme-status-info"
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                        <span className="flex items-center gap-1.5">
                          {report.status === "resolved" ? (
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                          )}
                          <span>Phản hồi từ quản trị viên</span>
                        </span>
                        {report.resolvedAt && (
                          <span className="font-normal opacity-85">
                            Giải quyết lúc: {formatVietnamDateTime(report.resolvedAt)}
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {report.adminResponse}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border theme-border theme-surface-muted px-3.5 py-2.5 text-xs theme-text-muted">
                      Chưa có phản hồi từ quản trị viên.
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            );
          })}
        </div>
      )}

      <BugReportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={(created) => {
          setReports((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
        }}
      />
    </div>
  );
}

export default BugReportsPage;
