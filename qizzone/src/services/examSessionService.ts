import { rpc } from "@/lib/cloud";
import type { ExamResult } from "@/types/exam";
import type { OptionId } from "@/types/quiz";

export const examSessionService = {
  listSessions: () => rpc<unknown>("list_sessions"),
  listResults: () => rpc<unknown>("list_results"),
  startAttempt: (quizId: string, studentClass?: string) =>
    rpc<unknown>("start_attempt", {
      p_quiz_id: quizId,
      p_class: studentClass || null,
    }),
  saveAttempt: (params: {
    attemptId: string;
    revision: number;
    answers: Record<string, OptionId[]>;
    flaggedQuestionIds: string[];
    currentQuestionIndex: number;
  }) =>
    rpc<unknown>("save_attempt", {
      p_id: params.attemptId,
      p_revision: params.revision,
      p_answers: params.answers,
      p_flags: params.flaggedQuestionIds,
      p_index: params.currentQuestionIndex,
    }),
  submitAttempt: (attemptId: string) =>
    rpc<ExamResult>("submit_attempt", { p_id: attemptId }),
  finalizeExpired: () => rpc<void>("finalize_expired"),
};
