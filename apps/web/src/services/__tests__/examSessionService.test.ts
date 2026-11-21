import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloud", () => ({ rpc: vi.fn() }));

import { rpc } from "@/lib/cloud";
import { examSessionService } from "@/services/examSessionService";

describe("examSessionService", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
