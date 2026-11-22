import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BugReport } from "@qizzone/domain";

const mocks = vi.hoisted(() => ({
  createReport: vi.fn(),
  listReports: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  user: {
    id: "student-1",
    email: "hs@example.test",
    fullName: "Học sinh A",
    role: "student" as const,
    approvalStatus: "approved" as const,
    createdAt: "2026-11-22T00:00:00.000Z",
  },
}));

vi.mock("@/services/bugReportService", () => ({
  bugReportService: {
    createReport: mocks.createReport,
    listReports: mocks.listReports,
    updateStatus: vi.fn(),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    info: mocks.toastInfo,
  }),
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      user: mocks.user,
      refreshProfile: vi.fn(),
      switchRole: vi.fn(),
    }),
}));

import { BugReportModal } from "@/components/common/BugReportModal";
import { BugReportsPage } from "@/components/common/BugReportsPage";

const sampleReports: BugReport[] = [
  {
    id: "aaaa1111-1111-4111-8111-111111111111",
    reporterUid: "student-1",
    reporterRole: "student",
    title: "Lỗi hiển thị công thức toán",
    description: "Công thức KaTeX bị tràn khung trên điện thoại.",
    category: "ui",
    severity: "medium",
    pageRoute: "/student/quiz/q1",
    contextMetadata: { role: "student" },
    status: "new",
    adminResponse: null,
    handledBy: null,
    resolvedAt: null,
    createdAt: "2026-11-22T01:00:00.000Z",
    updatedAt: "2026-11-22T01:00:00.000Z",
  },
  {
    id: "bbbb2222-2222-4222-8222-222222222222",
    reporterUid: "student-1",
    reporterRole: "student",
    title: "Nút nộp bài phản hồi chậm",
    description: "Sau khi nhấn nộp bài mất khoảng 5 giây mới chuyển trang kết quả.",
    category: "performance",
    severity: "high",
    pageRoute: "/student/quiz/q2",
    contextMetadata: { role: "student" },
    status: "resolved",
    adminResponse: "Đã tối ưu hóa hàm chấm điểm phía máy chủ.",
    handledBy: "admin-1",
    resolvedAt: "2026-11-22T03:00:00.000Z",
    createdAt: "2026-11-22T00:30:00.000Z",
    updatedAt: "2026-11-22T03:00:00.000Z",
  },
];

describe("BugReportModal & BugReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listReports.mockResolvedValue(sampleReports);
  });

  it("validates fields and submits a bug report with role and route context", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const createdReport: BugReport = {
      ...sampleReports[0],
      id: "cccc3333-3333-4333-8333-333333333333",
      title: "Lỗi không tải được đề thi",
      description: "Mở trang lớp học và bấm vào đề kiểm tra thì bị trắng màn hình.",
    };
    mocks.createReport.mockResolvedValue(createdReport);

    render(
      <MemoryRouter initialEntries={["/student/classes?tab=assigned"]}>
        <BugReportModal
          isOpen={true}
          onClose={onClose}
          onCreated={onCreated}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("/student/classes?tab=assigned")).toBeInTheDocument();
    expect(screen.getByText("Học sinh")).toBeInTheDocument();

    // Submit empty -> validation errors
    fireEvent.click(screen.getByRole("button", { name: "Gửi báo lỗi" }));
    expect(await screen.findByText(/Tiêu đề báo lỗi cần ít nhất 3 ký tự/i)).toBeInTheDocument();
    expect(screen.getByText(/Mô tả chi tiết cần ít nhất 10 ký tự/i)).toBeInTheDocument();
    expect(mocks.createReport).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Tiêu đề lỗi *"), {
      target: { value: "Lỗi không tải được đề thi" },
    });
    fireEvent.change(screen.getByLabelText("Phân loại"), {
      target: { value: "exam" },
    });
    fireEvent.change(screen.getByLabelText("Mức độ nghiêm trọng"), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByLabelText("Mô tả chi tiết *"), {
      target: {
        value: "Mở trang lớp học và bấm vào đề kiểm tra thì bị trắng màn hình.",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Gửi báo lỗi" }));

    await waitFor(() => {
      expect(mocks.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Lỗi không tải được đề thi",
          category: "exam",
          severity: "high",
          pageRoute: "/student/classes?tab=assigned",
          contextMetadata: expect.objectContaining({ role: "student" }),
        }),
      );
      expect(onCreated).toHaveBeenCalledWith(createdReport);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it("renders BugReportsPage statuses, filter tabs, admin response, and ?reportId= deep-link highlight", async () => {
    render(
      <MemoryRouter
        initialEntries={["/student/bug-reports?reportId=bbbb2222-2222-4222-8222-222222222222"]}
      >
        <BugReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Nút nộp bài phản hồi chậm")).toBeInTheDocument();
    expect(screen.getByText("Được mở từ thông báo")).toBeInTheDocument();
    expect(
      screen.getByText("Đã tối ưu hóa hàm chấm điểm phía máy chủ."),
    ).toBeInTheDocument();

    // Verify filter labels exist
    expect(screen.getByRole("button", { name: /^Mới/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Đang xử lý/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Đã giải quyết/i })).toBeInTheDocument();

    // Filter to "Mới" only
    fireEvent.click(screen.getByRole("button", { name: /^Mới/i }));
    await waitFor(() => {
      expect(screen.getByText("Lỗi hiển thị công thức toán")).toBeInTheDocument();
      expect(screen.queryByText("Nút nộp bài phản hồi chậm")).not.toBeInTheDocument();
    });
  });

  it("fetches reports only once on mount error without an infinite toast-refetch loop", async () => {
    mocks.listReports.mockRejectedValue(new Error("Lỗi kết nối máy chủ"));

    render(
      <MemoryRouter initialEntries={["/student/bug-reports"]}>
        <BugReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Lỗi kết nối máy chủ")).toBeInTheDocument();
    expect(mocks.listReports).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith("Lỗi kết nối máy chủ");
    expect(screen.getByLabelText("Tìm kiếm phiếu báo lỗi")).toBeInTheDocument();
  });
});
