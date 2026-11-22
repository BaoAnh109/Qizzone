import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quiz } from "@qizzone/domain";

const mocks = vi.hoisted(() => {
  const unsubscribeChannel = vi.fn();
  const subscribeFn = vi.fn();
  const onFn = vi.fn();
  const channelObj = {
    on: onFn,
    subscribe: subscribeFn,
  };
  onFn.mockReturnValue(channelObj);
  subscribeFn.mockReturnValue(channelObj);

  return {
    rpc: vi.fn(),
    edge: vi.fn(),
    removeChannel: vi.fn().mockResolvedValue("ok"),
    channel: vi.fn(() => channelObj),
    onFn,
    subscribeFn,
    unsubscribeChannel,
    channelObj,
    realtimeHandler: undefined as undefined | ((payload: Record<string, unknown>) => void),
  };
});

mocks.onFn.mockImplementation((_type: string, _filter: unknown, cb: (payload: Record<string, unknown>) => void) => {
  mocks.realtimeHandler = cb;
  return mocks.channelObj;
});

vi.mock("@/lib/cloud", () => ({
  rpc: mocks.rpc,
  edge: mocks.edge,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
  supabase: () => ({
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  }),
}));

import { adminService } from "@/services/adminService";
import { bugReportService } from "@/services/bugReportService";
import { classroomService } from "@/services/classroomService";
import { examSessionService } from "@/services/examSessionService";
import {
  mapRealtimeNotification,
  notificationService,
} from "@/services/notificationService";
import { quizService } from "@/services/quizService";
import { useClassroomStore } from "@/store/classroomStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useQuizStore } from "@/store/quizStore";

describe("V3 services and stores", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.realtimeHandler = undefined;
    mocks.removeChannel.mockResolvedValue("ok");
    mocks.channel.mockReturnValue(mocks.channelObj);
    mocks.subscribeFn.mockReturnValue(mocks.channelObj);
    mocks.onFn.mockImplementation(
      (_type: string, _filter: unknown, cb: (payload: Record<string, unknown>) => void) => {
        mocks.realtimeHandler = cb;
        return mocks.channelObj;
      },
    );
    useClassroomStore.getState().reset();
    useNotificationStore.getState().reset();
    useQuizStore.getState().reset();
  });

  it("classroomService validates and invokes classroom/assignment RPCs", async () => {
    const classroom = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      teacherUid: "t-1",
      name: "Toán 12A1",
      subject: "Toán",
      gradeLevel: "12",
      description: "",
      inviteCode: "CLS123",
      inviteEnabled: true,
      isArchived: false,
      memberCount: 1,
      assignmentCount: 0,
      createdAt: "2026-11-22T00:00:00Z",
      updatedAt: "2026-11-22T00:00:00Z",
    };

    mocks.rpc.mockResolvedValueOnce(classroom);
    await expect(
      classroomService.createClassroom({
        name: "  Toán 12A1 ",
        subject: "Toán",
        gradeLevel: "12",
        description: "",
      }),
    ).resolves.toEqual(classroom);

    expect(mocks.rpc).toHaveBeenCalledWith("create_classroom", {
      p_name: "Toán 12A1",
      p_subject: "Toán",
      p_grade_level: "12",
      p_description: "",
    });

    mocks.rpc.mockResolvedValueOnce(classroom);
    await classroomService.joinByCode(" cls123 ", "link");
    expect(mocks.rpc).toHaveBeenLastCalledWith("join_classroom_by_code", {
      p_code: "CLS123",
      p_via: "link",
    });

    mocks.rpc.mockResolvedValueOnce({
      addedActive: 1,
      addedPending: 0,
      skippedExisting: 0,
      invalidEmails: [],
    });
    await classroomService.addMembersBulk({
      classroomId: "550e8400-e29b-41d4-a716-446655440000",
      emails: ["hs1@example.test"],
      joinedVia: "excel_import",
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith("add_classroom_members_bulk", {
      p_classroom_id: "550e8400-e29b-41d4-a716-446655440000",
      p_emails: ["hs1@example.test"],
      p_joined_via: "excel_import",
    });

    mocks.rpc.mockResolvedValueOnce(undefined);
    await classroomService.removeMember(
      "550e8400-e29b-41d4-a716-446655440000",
      "member-row-uuid",
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith("remove_classroom_member", {
      p_classroom_id: "550e8400-e29b-41d4-a716-446655440000",
      p_member_id: "member-row-uuid",
    });
  });

  it("notificationService maps snake_case realtime rows and manages channel subscription", async () => {
    const realtimeNotifId = "44444444-4444-4444-8444-444444444444";
    const mapped = mapRealtimeNotification({
      id: "550e8400-e29b-41d4-a716-446655440010",
      recipient_uid: "u-1",
      actor_uid: null,
      type: "quiz_assigned",
      title: "Bài tập mới",
      body: "Bạn có bài mới",
      target_route: "/student/classes/c-1",
      metadata: { classroomId: "c-1" },
      is_read: false,
      read_at: null,
      created_at: "2026-11-22T01:00:00Z",
    });
    expect(mapped.recipientUid).toBe("u-1");
    expect(mapped.targetRoute).toBe("/student/classes/c-1");
    expect(mapped.isRead).toBe(false);

    mocks.rpc.mockResolvedValueOnce({ unreadCount: 0, items: [] });
    await useNotificationStore.getState().load();

    const cleanup = useNotificationStore.getState().subscribeRealtime("u-1");
    expect(mocks.channel).toHaveBeenCalledWith("in-app-notifications:u-1");
    expect(mocks.onFn).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "in_app_notifications",
        filter: "recipient_uid=eq.u-1",
      },
      expect.any(Function),
    );

    mocks.realtimeHandler?.({
      eventType: "INSERT",
      new: {
        id: realtimeNotifId,
        recipient_uid: "u-1",
        actor_uid: "t-1",
        type: "quiz_assigned",
        title: "Realtime",
        body: "Thông báo mới",
        target_route: "/student/classes/c-1",
        metadata: {},
        is_read: false,
        read_at: null,
        created_at: "2026-11-22T02:00:00Z",
      },
    });
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    mocks.rpc.mockResolvedValueOnce(1);
    await useNotificationStore.getState().markRead([realtimeNotifId]);
    expect(useNotificationStore.getState().unreadCount).toBe(0);

    cleanup();
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channelObj);
  });

  it("bugReportService validates and calls create, list, and update status RPCs", async () => {
    mocks.rpc.mockResolvedValueOnce({ id: "br-1" });
    await bugReportService.createReport({
      title: "Lỗi giao diện",
      description: "Mô tả chi tiết ít nhất 10 ký tự.",
      category: "ui",
      severity: "high",
      pageRoute: "/student/classes",
      contextMetadata: { role: "student" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_bug_report", {
      p_title: "Lỗi giao diện",
      p_description: "Mô tả chi tiết ít nhất 10 ký tự.",
      p_category: "ui",
      p_severity: "high",
      p_page_route: "/student/classes",
      p_context_metadata: { role: "student" },
    });

    mocks.rpc.mockResolvedValueOnce([]);
    await bugReportService.listReports({ status: "new", role: "student" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_bug_reports", {
      p_status: "new",
      p_role: "student",
    });

    mocks.rpc.mockResolvedValueOnce({ id: "br-1", status: "resolved" });
    await bugReportService.updateStatus({
      reportId: "550e8400-e29b-41d4-a716-446655440000",
      status: "resolved",
      adminResponse: "Đã khắc phục.",
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith("update_bug_report_status", {
      p_report_id: "550e8400-e29b-41d4-a716-446655440000",
      p_status: "resolved",
      p_admin_response: "Đã khắc phục.",
    });
  });

  it("adminService V3 methods, quizService/Store Azota helpers, and examSessionService assignmentId work as specified", async () => {
    mocks.edge.mockResolvedValueOnce({
      accounts: [
        {
          id: "u-1",
          email: "t@example.test",
          full_name: "Teacher",
          role: "teacher",
          approval_status: "approved",
          classroom_count: 3,
          quiz_count: 5,
          submission_count: 10,
          created_at: "2026-11-22T00:00:00Z",
        },
      ],
    });
    const summaries = await adminService.listAccountSummaries("teacher");
    expect(summaries[0]).toMatchObject({
      id: "u-1",
      classroomCount: 3,
      quizCount: 5,
      submissionCount: 10,
      isBlocked: false,
    });

    mocks.edge.mockResolvedValueOnce({ profile: { id: "u-1" }, stats: {} });
    await adminService.getAccountDetail("u-1");
    expect(mocks.edge).toHaveBeenLastCalledWith(
      "manage-user-accounts",
      { action: "detail", userId: "u-1" },
      15_000,
    );

    mocks.edge.mockResolvedValueOnce({ active_role: "teacher" });
    await adminService.changeUserRole("u-1", "teacher");
    expect(mocks.edge).toHaveBeenLastCalledWith(
      "manage-user-accounts",
      { action: "change_role", userId: "u-1", nextRole: "teacher" },
      15_000,
    );

    mocks.edge.mockResolvedValueOnce({ profile: {} });
    await adminService.reviewTeacherAccount("u-1", "approve");
    expect(mocks.edge).toHaveBeenLastCalledWith(
      "manage-user-accounts",
      { action: "review_teacher", userId: "u-1", decision: "approve" },
      15_000,
    );

    const quiz: Quiz = {
      id: "q-1",
      title: "Kiểm tra",
      subject: "Toán",
      teacherId: "t-1",
      code: "QZ1234",
      status: "published",
      settings: {
        durationMinutes: 30,
        shuffleQuestions: false,
        shuffleOptions: false,
        allowReview: true,
        maxAttempts: 1,
        passPercentage: 50,
        publishScope: "class_only",
        scoreVisibility: "after_close",
      },
      questions: [],
      totalQuestions: 0,
      totalPoints: 0,
      createdAt: "2026-11-22T00:00:00Z",
      updatedAt: "2026-11-22T00:00:00Z",
    };

    mocks.rpc.mockResolvedValueOnce(quiz);
    const joinedQuiz = await useQuizStore.getState().joinQuizByCode(" qz1234 ");
    expect(joinedQuiz.id).toBe("q-1");
    expect(mocks.rpc).toHaveBeenLastCalledWith("join_quiz_by_code", {
      p_code: "QZ1234",
    });

    mocks.rpc.mockResolvedValueOnce({ ...quiz, status: "closed" });
    await quizService.updatePublishSettings(
      "q-1",
      { scoreVisibility: "immediate" },
      "closed",
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith("update_quiz_publish_settings", {
      p_quiz_id: "q-1",
      p_settings: { scoreVisibility: "immediate" },
      p_status: "closed",
    });

    mocks.rpc.mockResolvedValueOnce({});
    await examSessionService.startAttempt("q-1", "12A1", "assign-1");
    expect(mocks.rpc).toHaveBeenLastCalledWith("start_attempt", {
      p_quiz_id: "q-1",
      p_class: "12A1",
      p_assignment_id: "assign-1",
    });

    // Keep notificationService referenced directly
    mocks.rpc.mockResolvedValueOnce(0);
    await notificationService.markNotificationsRead(null);
    expect(mocks.rpc).toHaveBeenLastCalledWith("mark_notifications_read", {
      p_ids: null,
    });
  });

  it("classroomStore loads classrooms and resets cleanly", async () => {
    mocks.rpc.mockResolvedValueOnce([
      {
        id: "cls-1",
        teacherUid: "t-1",
        name: "12A1",
        subject: "Toán",
        gradeLevel: "12",
        description: "",
        inviteCode: "CLS111",
        inviteEnabled: true,
        isArchived: false,
        memberCount: 2,
        assignmentCount: 1,
        createdAt: "2026-11-22T00:00:00Z",
        updatedAt: "2026-11-22T00:00:00Z",
      },
    ]);

    await useClassroomStore.getState().loadClassrooms();
    expect(useClassroomStore.getState().classrooms).toHaveLength(1);

    useClassroomStore.getState().reset();
    expect(useClassroomStore.getState().classrooms).toEqual([]);
  });
});
