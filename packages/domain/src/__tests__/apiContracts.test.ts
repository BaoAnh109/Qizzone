import { describe, expect, it } from "vitest";
import {
  addClassroomMembersBulkSchema,
  adminChangeRoleSchema,
  adminReviewTeacherSchema,
  adminToggleBlockSchema,
  assignQuizToClassroomsSchema,
  BUG_REPORT_STATUSES,
  confirmUploadRequestSchema,
  createBugReportSchema,
  createClassroomSchema,
  createUploadUrlRequestSchema,
  extractQuizRequestSchema,
  finalizeExamRequestSchema,
  finalizeExamResponseSchema,
  joinClassroomByCodeSchema,
  listBugReportsFilterSchema,
  manageUserAccountsRequestSchema,
  markNotificationsReadSchema,
  MAX_DIRECT_UPLOAD_BYTES,
  OPTION_IDS,
  questionSchema,
  quizSettingsSchema,
  resolveQuizAnswerVisibility,
  updateBugReportStatusSchema,
  updateClassroomSchema,
  computeNotificationRetryDelaySeconds,
  formatVietnamDateTime,
  type ExamResult,
} from "../index";

describe("@qizzone/domain contracts and schemas", () => {
  it("supports 2 to 5 options (A-E) in questionSchema and rejects invalid answer letters", () => {
    expect(OPTION_IDS).toEqual(["A", "B", "C", "D", "E"]);
    const fiveOptionValid = questionSchema.safeParse({
      content: "Câu hỏi 5 lựa chọn",
      type: "single_choice",
      options: [
        { id: "A", content: "1" },
        { id: "B", content: "2" },
        { id: "C", content: "3" },
        { id: "D", content: "4" },
        { id: "E", content: "5" },
      ],
      correctAnswers: ["E"],
      points: 1,
    });
    expect(fiveOptionValid.success).toBe(true);

    const mismatchedAnswer = questionSchema.safeParse({
      content: "Câu hỏi sai đáp án",
      type: "single_choice",
      options: [
        { id: "A", content: "1" },
        { id: "B", content: "2" },
      ],
      correctAnswers: ["C"],
      points: 1,
    });
    expect(mismatchedAnswer.success).toBe(false);
  });

  it("validates R2 presigned upload contracts up to 50 MiB and rejects oversized or invalid MIME", () => {
    expect(
      createUploadUrlRequestSchema.safeParse({
        fileName: "de-thi-toan.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_DIRECT_UPLOAD_BYTES,
      }).success
    ).toBe(true);

    expect(
      createUploadUrlRequestSchema.safeParse({
        fileName: "too-big.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_DIRECT_UPLOAD_BYTES + 1,
      }).success
    ).toBe(false);

    expect(
      createUploadUrlRequestSchema.safeParse({
        fileName: "evil.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
      }).success
    ).toBe(false);

    expect(
      confirmUploadRequestSchema.safeParse({
        materialId: "550e8400-e29b-41d4-a716-446655440000",
      }).success
    ).toBe(true);
  });

  it("validates extract-quiz and finalize-exam contracts", () => {
    expect(extractQuizRequestSchema.safeParse({}).success).toBe(false);
    expect(
      extractQuizRequestSchema.safeParse({
        materialId: "550e8400-e29b-41d4-a716-446655440000",
        extractionMode: "scan_ocr_vlm",
        selectedPages: [1, 2, 3],
      }).success
    ).toBe(true);

    expect(
      finalizeExamRequestSchema.safeParse({
        attemptId: "550e8400-e29b-41d4-a716-446655440000",
        idempotencyKey: "submit-attempt-123456",
      }).success
    ).toBe(true);
  });

  it("computes bounded exponential retry delays and Vietnam timezone formatting", () => {
    expect(computeNotificationRetryDelaySeconds(1)).toBe(30);
    expect(computeNotificationRetryDelaySeconds(2)).toBe(60);
    expect(computeNotificationRetryDelaySeconds(10)).toBe(3600);
    const formatted = formatVietnamDateTime("2026-11-21T03:30:00.000Z");
    expect(formatted).toContain("10:30");
    expect(formatted).toContain("21/11/2026");
  });

  it("applies Azota defaults and date-order refinements in quizSettingsSchema and resolveQuizAnswerVisibility", () => {
    const parsed = quizSettingsSchema.parse({ durationMinutes: 45 });
    expect(parsed.publishScope).toBe("public");
    expect(parsed.opensAt).toBeNull();
    expect(parsed.closesAt).toBeNull();
    expect(parsed.scoreVisibility).toBe("immediate");
    expect(resolveQuizAnswerVisibility(parsed)).toBe("immediate");
    expect(resolveQuizAnswerVisibility({ allowReview: false })).toBe("never");
    expect(resolveQuizAnswerVisibility({ allowReview: true, answerVisibility: "after_close" })).toBe("after_close");

    expect(
      quizSettingsSchema.safeParse({
        durationMinutes: 45,
        opensAt: "2026-11-22T08:00:00+07:00",
        closesAt: "2026-11-22T10:00:00Z",
      }).success
    ).toBe(true);

    expect(
      quizSettingsSchema.safeParse({
        durationMinutes: 45,
        opensAt: "2026-11-22T10:00:00Z",
        closesAt: "2026-11-22T09:00:00Z",
      }).success
    ).toBe(false);

    expect(
      quizSettingsSchema.safeParse({
        durationMinutes: 45,
        maxAttempts: 100,
        assignedEmails: ["student@example.test"],
      }).success
    ).toBe(true);

    expect(
      quizSettingsSchema.safeParse({
        durationMinutes: 45,
        maxAttempts: 101,
      }).success
    ).toBe(false);

    expect(
      quizSettingsSchema.safeParse({
        durationMinutes: 45,
        assignedEmails: ["not-an-email"],
      }).success
    ).toBe(false);
  });

  it("validates classroom, bug report, notification, and admin account schemas", () => {
    expect(createClassroomSchema.parse({ name: "Lớp 12A1" }).subject).toBe("");
    expect(updateClassroomSchema.safeParse({ inviteEnabled: false }).success).toBe(true);
    expect(joinClassroomByCodeSchema.parse({ code: "AB12CD" }).via).toBe("code");
    expect(
      addClassroomMembersBulkSchema.safeParse({
        classroomId: "550e8400-e29b-41d4-a716-446655440000",
        emails: ["hs1@example.test"],
        joinedVia: "excel_import",
      }).success
    ).toBe(true);

    expect(
      assignQuizToClassroomsSchema.safeParse({
        quizId: "550e8400-e29b-41d4-a716-446655440000",
        assignments: [
          {
            classroomId: "550e8400-e29b-41d4-a716-446655440001",
            availableFrom: "2026-11-22T08:00:00Z",
            dueAt: "2026-11-22T07:00:00Z",
          },
        ],
      }).success
    ).toBe(false);

    expect(
      assignQuizToClassroomsSchema.safeParse({
        quizId: "550e8400-e29b-41d4-a716-446655440000",
        assignments: [
          {
            classroomId: "550e8400-e29b-41d4-a716-446655440001",
            availableFrom: "2026-11-22T10:00:00Z",
            dueAt: null,
            hardCloseAt: "2026-11-22T09:00:00Z",
          },
        ],
      }).success
    ).toBe(false);

    expect(
      assignQuizToClassroomsSchema.safeParse({
        quizId: "550e8400-e29b-41d4-a716-446655440000",
        assignments: [
          {
            classroomId: "550e8400-e29b-41d4-a716-446655440001",
            availableFrom: "2026-11-22T08:00:00Z",
            dueAt: null,
            hardCloseAt: "2026-11-22T10:00:00Z",
          },
        ],
      }).success
    ).toBe(true);

    expect(BUG_REPORT_STATUSES).toEqual(["new", "in_progress", "resolved"]);
    expect(
      createBugReportSchema.safeParse({
        title: "Lỗi nộp bài",
        description: "Khi nhấn nộp bài bị kẹt ở trạng thái đang xử lý.",
      }).success
    ).toBe(true);
    expect(
      updateBugReportStatusSchema.safeParse({
        reportId: "550e8400-e29b-41d4-a716-446655440000",
        status: "in_progress",
        adminResponse: "Đang kiểm tra log.",
      }).success
    ).toBe(true);
    expect(listBugReportsFilterSchema.safeParse({ status: "resolved", role: "teacher" }).success).toBe(true);
    expect(markNotificationsReadSchema.parse({}).ids).toBeNull();

    expect(adminToggleBlockSchema.safeParse({ action: "toggle_block", userId: "u1", isBlocked: true }).success).toBe(true);
    expect(adminChangeRoleSchema.safeParse({ action: "change_role", userId: "u1", nextRole: "teacher" }).success).toBe(true);
    expect(adminReviewTeacherSchema.safeParse({ action: "review_teacher", userId: "u1", decision: "approve" }).success).toBe(true);
    expect(manageUserAccountsRequestSchema.safeParse({ action: "detail", userId: "u1" }).success).toBe(true);
    expect(finalizeExamResponseSchema.safeParse({ score: null, status: "submitted", result: { scoreHidden: true } }).success).toBe(true);

    const redactedResult: ExamResult = {
      id: "res-redacted",
      quizId: "quiz-1",
      quizTitle: "Đề kiểm tra 15 phút",
      subject: "Toán học",
      roomCode: "QZ1234",
      studentId: "stu-1",
      studentName: "Học sinh A",
      scoreHidden: true,
      answersHidden: true,
      totalQuestions: 10,
      answeredCount: 10,
      correctCount: null,
      incorrectCount: null,
      skippedCount: 0,
      score: null,
      totalPointsEarned: null,
      maxTotalPoints: 10,
      percentage: null,
      isPassed: null,
      passPercentage: 50,
      academicRank: null,
      timeSpentSeconds: 300,
      details: [],
      submittedAt: "2026-11-22T08:00:00Z",
    };
    expect(redactedResult.score).toBeNull();
    expect(redactedResult.scoreHidden).toBe(true);
  });
});
