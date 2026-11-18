import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiConfigured: false, qizzoneApi: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/cloud", () => ({
  get isQizzoneApiConfigured() { return mocks.apiConfigured; },
  qizzoneApi: mocks.qizzoneApi,
  rpc: mocks.rpc,
}));

import { rpc } from "@/lib/cloud";
import { examSessionService } from "@/services/examSessionService";

describe("examSessionService", () => {
  beforeEach(() => {
    mocks.apiConfigured = false;
    vi.clearAllMocks();
  });

  it("maps session operations to their existing RPC names and arguments", async () => {
    await examSessionService.listSessions();
    await examSessionService.listResults();
    await examSessionService.startAttempt("quiz-1", "12A1");
    await examSessionService.startAttempt("quiz-2");
    await examSessionService.saveAttempt({
      attemptId: "attempt-1",
      revision: 3,
      answers: { "question-1": ["B"] },
      flaggedQuestionIds: ["question-2"],
      currentQuestionIndex: 1,
      mutationId: "mutation-1",
      clientSequence: 1,
      writerSessionId: "writer-1",
    });
    await examSessionService.submitAttempt("attempt-1");
    await examSessionService.finalizeExpired();

    expect(rpc).toHaveBeenNthCalledWith(1, "list_sessions");
    expect(rpc).toHaveBeenNthCalledWith(2, "list_results");
    expect(rpc).toHaveBeenNthCalledWith(3, "start_attempt", {
      p_quiz_id: "quiz-1",
      p_class: "12A1",
    });
    expect(rpc).toHaveBeenNthCalledWith(4, "start_attempt", {
      p_quiz_id: "quiz-2",
      p_class: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(5, "save_attempt", {
      p_id: "attempt-1",
      p_revision: 3,
      p_answers: { "question-1": ["B"] },
      p_flags: ["question-2"],
      p_index: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(6, "submit_attempt", { p_id: "attempt-1" });
    expect(rpc).toHaveBeenNthCalledWith(7, "finalize_expired");
  });

  it("uses the API contract and maps server timestamps and stable question order", async () => {
    mocks.apiConfigured = true;
    const apiAttempt = {
      id: "attempt-1",
      quizId: "quiz-1",
      quizTitle: "Demo exam",
      subject: "Math",
      roomCode: "ABC123",
      studentId: "student-1",
      studentName: "Test Student",
      studentClass: "12A1",
      startedAt: "2026-11-17T10:00:00.000Z",
      endsAt: "2026-11-17T10:30:00.000Z",
      durationMinutes: 30,
      answers: { "question-1": ["B"] },
      flaggedQuestionIds: ["question-2"],
      currentQuestionIndex: 1,
      mutationId: "mutation-1",
      clientSequence: 1,
      writerSessionId: "writer-1",
      revision: 3,
      isSubmitted: false,
      lastSavedAt: "2026-11-17T10:01:00.000Z",
      questions: [
        {
          id: "question-2", order: 0, content: "Second question", images: [], type: "single_choice",
          options: [{ id: "D", content: "four" }, { id: "A", content: "one" }], points: 1,
        },
        {
          id: "question-1", order: 1, content: "First question", images: [], type: "single_choice",
          options: [{ id: "B", content: "two" }, { id: "C", content: "three" }], points: 2,
        },
      ],
    };
    mocks.qizzoneApi
      .mockResolvedValueOnce([apiAttempt])
      .mockResolvedValueOnce([{ id: "result-1" }])
      .mockResolvedValueOnce(apiAttempt)
      .mockResolvedValueOnce(apiAttempt)
      .mockResolvedValueOnce({ id: "result-1" })
      .mockResolvedValueOnce(undefined);

    const sessions = await examSessionService.listSessions() as Array<Record<string, unknown>>;
    await examSessionService.listResults();
    const started = await examSessionService.startAttempt("quiz-1", "12A1");
    await examSessionService.saveAttempt({
      attemptId: "attempt-1",
      revision: 3,
      answers: { "question-1": ["B"] },
      flaggedQuestionIds: ["question-2"],
      currentQuestionIndex: 1,
      mutationId: "mutation-1",
      clientSequence: 1,
      writerSessionId: "writer-1",
    });
    await examSessionService.submitAttempt("attempt-1");
    await examSessionService.finalizeExpired();

    expect(sessions[0]).toMatchObject({
      quizTitle: "Demo exam",
      subject: "Math",
      roomCode: "ABC123",
      startTime: Date.parse(apiAttempt.startedAt),
      endTime: Date.parse(apiAttempt.endsAt),
      questionOrder: ["question-2", "question-1"],
      optionOrder: { "question-2": ["D", "A"], "question-1": ["B", "C"] },
      questions: [
        { id: "question-2", content: "Second question", correctAnswers: [], explanation: "" },
        { id: "question-1", content: "First question", correctAnswers: [], explanation: "" },
      ],
    });
    expect(started).toMatchObject({ quizId: "quiz-1", revision: 3 });
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(1, "/api/v1/exam-attempts/");
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(2, "/api/v1/exam-attempts/results");
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(3, "/api/v1/exam-attempts/quizzes/quiz-1", {
      method: "POST", body: JSON.stringify({ studentClass: "12A1" }),
    });
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(4, "/api/v1/exam-attempts/attempt-1/autosave", {
      method: "PUT",
      headers: { "Idempotency-Key": "mutation-1" },
      body: JSON.stringify({
        revision: 3,
        answers: { "question-1": ["B"] },
        flaggedQuestionIds: ["question-2"],
        currentQuestionIndex: 1,
        mutationId: "mutation-1",
        clientSequence: 1,
        writerSessionId: "writer-1",
      }),
    });
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(5, "/api/v1/exam-attempts/attempt-1/submit", { method: "POST" });
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(6, "/api/v1/exam-attempts/finalize-expired", { method: "POST" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("loads a filtered, paged quiz report from the API", async () => {
    mocks.apiConfigured = true;
    const report = {
      page: 2,
      pageSize: 25,
      totalItems: 26,
      totalPages: 2,
      summary: { totalSubmissions: 26 },
      questionAnalytics: [],
      items: [{ id: "result-26" }],
    };
    mocks.qizzoneApi.mockResolvedValueOnce(report);

    await expect(examSessionService.getQuizReport("quiz 1", {
      page: 2,
      pageSize: 25,
      search: "An Student",
      status: "failed",
      sortBy: "score_desc",
    })).resolves.toBe(report);

    expect(mocks.qizzoneApi).toHaveBeenCalledWith(
      "/api/v1/quizzes/quiz%201/reports?page=2&pageSize=25&search=An+Student&status=failed&sortBy=score_desc",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fetches every page when the teacher exports quiz results", async () => {
    mocks.apiConfigured = true;
    mocks.qizzoneApi
      .mockResolvedValueOnce({ totalPages: 2, items: [{ id: "result-1" }] })
      .mockResolvedValueOnce({ totalPages: 2, items: [{ id: "result-2" }] });

    await expect(examSessionService.getAllQuizReportResults("quiz-1", {
      status: "passed",
      sortBy: "score_asc",
    })).resolves.toEqual([{ id: "result-1" }, { id: "result-2" }]);

    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(
      1,
      "/api/v1/quizzes/quiz-1/reports?page=1&pageSize=100&status=passed&sortBy=score_asc&includeQuestionAnalytics=false",
    );
    expect(mocks.qizzoneApi).toHaveBeenNthCalledWith(
      2,
      "/api/v1/quizzes/quiz-1/reports?page=2&pageSize=100&status=passed&sortBy=score_asc&includeQuestionAnalytics=false",
    );
  });
});
