import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InAppNotification } from "@qizzone/domain";
import type { User } from "@/types/auth";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  refreshProfile: vi.fn(),
  switchRole: vi.fn(),
  loadNotifications: vi.fn().mockResolvedValue(undefined),
  markRead: vi.fn().mockResolvedValue(1),
  markAllRead: vi.fn().mockResolvedValue(2),
  authUser: {
    id: "user-1",
    email: "student@example.test",
    fullName: "Nguyễn An",
    role: "student",
    baseRole: "student",
    approvalStatus: "approved",
    teacherRequestStatus: "pending",
    createdAt: "2026-11-22T00:00:00.000Z",
  } as User,
  notifications: [] as InAppNotification[],
  unreadCount: 0,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

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
      user: mocks.authUser,
      refreshProfile: mocks.refreshProfile,
      switchRole: mocks.switchRole,
    }),
}));

vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      notifications: mocks.notifications,
      unreadCount: mocks.unreadCount,
      isLoading: false,
      load: mocks.loadNotifications,
      markRead: mocks.markRead,
      markAllRead: mocks.markAllRead,
    }),
}));

import { NotificationBell } from "@/components/common/NotificationBell";

const sampleNotifications: InAppNotification[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    recipientUid: "user-1",
    actorUid: "admin-1",
    type: "teacher_approval",
    title: "Yêu cầu giáo viên đã được duyệt",
    body: "Bạn có thể chuyển sang giao diện giáo viên ngay bây giờ.",
    targetRoute: "/teacher",
    metadata: { decision: "approve", requestKind: "student_switch" },
    isRead: false,
    readAt: null,
    createdAt: "2026-11-22T03:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    recipientUid: "user-1",
    actorUid: "teacher-1",
    type: "quiz_assigned",
    title: "Bài tập mới: Toán 12",
    body: "Giáo viên vừa giao bài kiểm tra 15 phút cho lớp 12A1.",
    targetRoute: "/student/classes/cls-1",
    metadata: {},
    isRead: false,
    readAt: null,
    createdAt: "2026-11-22T02:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    recipientUid: "user-1",
    actorUid: "admin-1",
    type: "role_changed",
    title: "Vai trò tài khoản đã được cập nhật",
    body: "Quản trị viên đã cập nhật vai trò của bạn.",
    targetRoute: "/teacher",
    metadata: { nextRole: "teacher" },
    isRead: true,
    readAt: "2026-11-22T01:30:00.000Z",
    createdAt: "2026-11-22T01:00:00.000Z",
  },
];

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUser = {
      id: "user-1",
      email: "student@example.test",
      fullName: "Nguyễn An",
      role: "student",
      baseRole: "student",
      approvalStatus: "approved",
      teacherRequestStatus: "pending",
      createdAt: "2026-11-22T00:00:00.000Z",
    };
    mocks.notifications = [...sampleNotifications];
    mocks.unreadCount = 2;
  });

  it("renders unread count badge and opens/closes popover via Escape and outside click with focus return", () => {
    render(
      <div>
        <div data-testid="outside-area">Ngoài popover</div>
        <NotificationBell />
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Thông báo (2 chưa đọc)" });
    expect(trigger).toHaveTextContent("2");

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Danh sách thông báo" })).toBeInTheDocument();
    expect(screen.getByText("Yêu cầu giáo viên đã được duyệt")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports marking a single notification read without navigating and marking all as read", async () => {
    render(<NotificationBell />);

    fireEvent.click(screen.getByRole("button", { name: "Thông báo (2 chưa đọc)" }));

    const markOneBtn = screen.getByRole("button", {
      name: "Đánh dấu đã đọc: Bài tập mới: Toán 12",
    });
    fireEvent.click(markOneBtn);
    await waitFor(() => {
      expect(mocks.markRead).toHaveBeenCalledWith(["22222222-2222-4222-8222-222222222222"]);
    });
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Đọc tất cả" }));
    await waitFor(() => {
      expect(mocks.markAllRead).toHaveBeenCalledOnce();
    });
  });

  it("refreshes profile and switches role to teacher before navigating on teacher_approval", async () => {
    mocks.refreshProfile.mockResolvedValue({
      ...mocks.authUser,
      role: "student",
      teacherRequestStatus: "approved",
    });
    mocks.switchRole.mockResolvedValue({
      ...mocks.authUser,
      role: "teacher",
      teacherRequestStatus: "approved",
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (2 chưa đọc)" }));
    fireEvent.click(screen.getByText("Yêu cầu giáo viên đã được duyệt"));

    await waitFor(() => {
      expect(mocks.markRead).toHaveBeenCalledWith(["11111111-1111-4111-8111-111111111111"]);
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.switchRole).toHaveBeenCalledWith("teacher");
      expect(mocks.navigate).toHaveBeenCalledWith("/teacher");
    });
  });

  it("refreshes profile on role_changed notification and navigates when authorized", async () => {
    mocks.refreshProfile.mockResolvedValue({
      ...mocks.authUser,
      role: "teacher",
      baseRole: "teacher",
      teacherRequestStatus: "approved",
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (2 chưa đọc)" }));
    fireEvent.click(screen.getByText("Vai trò tài khoản đã được cập nhật"));

    await waitFor(() => {
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.navigate).toHaveBeenCalledWith("/teacher");
    });
  });

  it("switches dual-role teacher back to student when clicking a /student/bug-reports notification", async () => {
    mocks.authUser = {
      ...mocks.authUser,
      role: "teacher",
      baseRole: "student",
      teacherRequestStatus: "approved",
    };
    mocks.notifications = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        recipientUid: "user-1",
        actorUid: "admin-1",
        type: "bug_report_updated",
        title: "Phản hồi báo lỗi",
        body: "Admin đã phản hồi phiếu báo lỗi của bạn.",
        targetRoute: "/student/bug-reports?reportId=rep-1",
        metadata: {},
        isRead: false,
        readAt: null,
        createdAt: "2026-11-22T04:00:00.000Z",
      },
    ];
    mocks.unreadCount = 1;
    mocks.refreshProfile.mockResolvedValue({ ...mocks.authUser });
    mocks.switchRole.mockResolvedValue({ ...mocks.authUser, role: "student" });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (1 chưa đọc)" }));
    fireEvent.click(screen.getByText("Phản hồi báo lỗi"));

    await waitFor(() => {
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.switchRole).toHaveBeenCalledWith("student");
      expect(mocks.navigate).toHaveBeenCalledWith("/student/bug-reports?reportId=rep-1");
    });
  });

  it("rewrites /student/bug-reports to /teacher/bug-reports for pure teacher without calling switchRole", async () => {
    mocks.authUser = {
      ...mocks.authUser,
      role: "teacher",
      baseRole: "teacher",
      teacherRequestStatus: "approved",
    };
    mocks.notifications = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        recipientUid: "user-1",
        actorUid: "admin-1",
        type: "bug_report_updated",
        title: "Cập nhật phiếu báo lỗi",
        body: "Đã chuyển sang đang xử lý.",
        targetRoute: "/student/bug-reports?reportId=rep-2",
        metadata: {},
        isRead: false,
        readAt: null,
        createdAt: "2026-11-22T04:00:00.000Z",
      },
    ];
    mocks.unreadCount = 1;
    mocks.refreshProfile.mockResolvedValue({ ...mocks.authUser });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (1 chưa đọc)" }));
    fireEvent.click(screen.getByText("Cập nhật phiếu báo lỗi"));

    await waitFor(() => {
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.switchRole).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("/teacher/bug-reports?reportId=rep-2");
    });
  });

  it("rewrites /student/bug-reports to /admin/bug-reports for admin without calling switchRole", async () => {
    mocks.authUser = {
      ...mocks.authUser,
      role: "admin",
      baseRole: "admin",
      teacherRequestStatus: "none",
    };
    mocks.notifications = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        recipientUid: "user-1",
        actorUid: "admin-2",
        type: "bug_report_updated",
        title: "Cập nhật báo lỗi admin",
        body: "Admin đã cập nhật.",
        targetRoute: "/student/bug-reports?reportId=rep-3",
        metadata: {},
        isRead: false,
        readAt: null,
        createdAt: "2026-11-22T04:00:00.000Z",
      },
    ];
    mocks.unreadCount = 1;
    mocks.refreshProfile.mockResolvedValue({ ...mocks.authUser });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (1 chưa đọc)" }));
    fireEvent.click(screen.getByText("Cập nhật báo lỗi admin"));

    await waitFor(() => {
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.switchRole).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("/admin/bug-reports?reportId=rep-3");
    });
  });

  it("navigates directly without calling switchRole when forward bug_report_* refresh returns teacher or admin", async () => {
    mocks.authUser = {
      ...mocks.authUser,
      role: "student",
      baseRole: "student",
      teacherRequestStatus: "approved",
    };
    mocks.notifications = [
      {
        id: "77777777-7777-4777-8777-777777777777",
        recipientUid: "user-1",
        actorUid: "admin-1",
        type: "bug_report_updated",
        title: "Báo lỗi giáo viên",
        body: "Đã giải quyết.",
        targetRoute: "/teacher/bug-reports?reportId=rep-4",
        metadata: {},
        isRead: false,
        readAt: null,
        createdAt: "2026-11-22T04:00:00.000Z",
      },
    ];
    mocks.unreadCount = 1;
    mocks.refreshProfile.mockResolvedValue({
      ...mocks.authUser,
      role: "admin",
      baseRole: "admin",
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (1 chưa đọc)" }));
    fireEvent.click(screen.getByText("Báo lỗi giáo viên"));

    await waitFor(() => {
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.switchRole).not.toHaveBeenCalled();
      expect(mocks.navigate).toHaveBeenCalledWith("/teacher/bug-reports?reportId=rep-4");
    });
  });

  it("switches dual-role teacher to student when clicking quiz_assigned (/student/classes/...)", async () => {
    mocks.authUser = {
      ...mocks.authUser,
      role: "teacher",
      baseRole: "student",
      teacherRequestStatus: "approved",
    };
    mocks.refreshProfile.mockResolvedValue({ ...mocks.authUser });
    mocks.switchRole.mockResolvedValue({ ...mocks.authUser, role: "student" });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: "Thông báo (2 chưa đọc)" }));
    fireEvent.click(screen.getByText("Bài tập mới: Toán 12"));

    await waitFor(() => {
      expect(mocks.refreshProfile).toHaveBeenCalledOnce();
      expect(mocks.switchRole).toHaveBeenCalledWith("student");
      expect(mocks.navigate).toHaveBeenCalledWith("/student/classes/cls-1");
    });
  });
});
