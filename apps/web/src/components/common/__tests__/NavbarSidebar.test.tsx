import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/types/auth";

const mocks = vi.hoisted(() => ({
  user: {
    id: "admin-1",
    email: "admin@example.test",
    fullName: "Admin",
    role: "admin",
    approvalStatus: "approved",
    createdAt: "2026-11-22T00:00:00.000Z",
  } as User,
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      user: mocks.user,
      logout: vi.fn(),
      requestTeacherAccess: vi.fn(),
      switchRole: vi.fn(),
      refreshProfile: vi.fn(),
    }),
}));

vi.mock("@/store/notificationStore", () => ({
  useNotificationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      notifications: [],
      unreadCount: 0,
      isLoading: false,
      load: vi.fn().mockResolvedValue(undefined),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    }),
}));

vi.mock("@/store/themeStore", () => ({
  useThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      preference: "light",
      resolvedTheme: "light",
      setPreference: vi.fn(),
    }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

import { Navbar } from "@/components/common/Navbar";
import { Sidebar } from "@/components/common/Sidebar";

describe("Sidebar & Navbar M2 routing integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Admin sidebar without duplicating /teacher/bug-reports", () => {
    mocks.user = {
      ...mocks.user,
      role: "admin",
    };

    render(
      <MemoryRouter initialEntries={["/admin/bug-reports"]}>
        <Sidebar />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole("link");
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/admin/bug-reports");
    expect(hrefs).toContain("/teacher/classes");
    expect(hrefs).not.toContain("/teacher/bug-reports");
    expect(screen.getAllByText(/Báo lỗi/i)).toHaveLength(1);
  });

  it("renders NotificationBell, quick bug button for student/teacher, and M3-M5 page titles in Navbar", () => {
    mocks.user = {
      ...mocks.user,
      role: "student",
    };

    render(
      <MemoryRouter initialEntries={["/student/classes"]}>
        <Navbar />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Lớp học của tôi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Báo lỗi hệ thống" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thông báo" })).toBeInTheDocument();
  });

  it("closes Navbar profile menu on Escape and returns focus to trigger", () => {
    mocks.user = {
      ...mocks.user,
      role: "student",
      baseRole: "student",
    };

    render(
      <MemoryRouter initialEntries={["/student/classes"]}>
        <Navbar />
      </MemoryRouter>,
    );

    const profileBtn = screen.getByRole("button", { name: "Mở tài khoản" });
    expect(profileBtn).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(profileBtn);
    expect(screen.getByRole("button", { name: "Cài đặt tài khoản" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Cài đặt tài khoản" })).not.toBeInTheDocument();
    expect(profileBtn).toHaveFocus();
  });

  it("renders Sidebar mobile drawer as dialog and closes on Escape", () => {
    mocks.user = {
      ...mocks.user,
      role: "student",
      baseRole: "student",
    };

    const onCloseMobile = vi.fn();
    render(
      <MemoryRouter initialEntries={["/student/classes"]}>
        <Sidebar isOpenMobile={true} onCloseMobile={onCloseMobile} />
      </MemoryRouter>,
    );

    const drawer = screen.getByRole("dialog", { name: "Menu điều hướng" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseMobile).toHaveBeenCalledOnce();
  });
});
