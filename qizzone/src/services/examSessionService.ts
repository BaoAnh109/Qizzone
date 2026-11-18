import { isQizzoneApiConfigured, qizzoneApi, rpc } from "@/lib/cloud";
import type { ExamResult, QuizReportQuery, QuizResultsReport } from "@/types/exam";
import type { OptionId } from "@/types/quiz";

interface ApiExamAttempt {
  id: string;
  quizId: string;
  studentId: string;
  studentName: string;
  studentClass?: string | null;
  startedAt: string;
  endsAt: string | null;
  durationMinutes: number;
  answers: Record<string, OptionId[]>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  revision: number;
  isSubmitted: boolean;
  lastSavedAt: string;
  mutationId?: string | null;
  questions: Array<{ id: string; options: Array<{ id: OptionId }> }>;
}

function mapApiAttempt(attempt: ApiExamAttempt) {
  return {
    ...attempt,
    startTime: Date.parse(attempt.startedAt),
    endTime: attempt.endsAt ? Date.parse(attempt.endsAt) : 0,
    lastSavedAt: attempt.lastSavedAt,
    questionOrder: attempt.questions.map(question => question.id),
    optionOrder: Object.fromEntries(attempt.questions.map(question => [
      question.id,
      question.options.map(option => option.id),
    ])),
  };
}

export const examSessionService = {
  listSessions: async () => {
    if (isQizzoneApiConfigured) {
      const attempts = await qizzoneApi<ApiExamAttempt[]>('/api/v1/exam-attempts/');
      return attempts.map(mapApiAttempt);
    }
    return rpc<unknown>("list_sessions");
  },
  listResults: () => isQizzoneApiConfigured
    ? qizzoneApi<ExamResult[]>('/api/v1/exam-attempts/results')
    : rpc<unknown>("list_results"),
  getQuizReport: (quizId: string, query: QuizReportQuery = {}) => {
    if (!isQizzoneApiConfigured) {
      throw new Error("Báo cáo phân trang chỉ khả dụng khi dùng Qizzone API.");
    }
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set("page", String(query.page));
    if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
    if (query.search) params.set("search", query.search);
    if (query.status) params.set("status", query.status);
    if (query.sortBy) params.set("sortBy", query.sortBy);
    if (query.includeQuestionAnalytics !== undefined) {
      params.set("includeQuestionAnalytics", String(query.includeQuestionAnalytics));
    }
    const queryString = params.toString();
    return qizzoneApi<QuizResultsReport>(
      `/api/v1/quizzes/${encodeURIComponent(quizId)}/reports${queryString ? `?${queryString}` : ""}`,
    );
  },
  getAllQuizReportResults: async (
    quizId: string,
    query: Omit<QuizReportQuery, "page" | "pageSize"> = {},
  ) => {
    const firstPage = await examSessionService.getQuizReport(quizId, {
      ...query,
      page: 1,
      pageSize: 100,
      includeQuestionAnalytics: false,
    });
    const results = [...firstPage.items];
    for (let page = 2; page <= firstPage.totalPages; page += 1) {
      const nextPage = await examSessionService.getQuizReport(quizId, {
        ...query,
        page,
        pageSize: 100,
        includeQuestionAnalytics: false,
      });
      results.push(...nextPage.items);
    }
    return results;
  },
  startAttempt: async (quizId: string, studentClass?: string) => {
    if (isQizzoneApiConfigured) {
      return mapApiAttempt(await qizzoneApi<ApiExamAttempt>(`/api/v1/exam-attempts/quizzes/${quizId}`, {
        method: 'POST',
        body: JSON.stringify({ studentClass: studentClass ?? null }),
      }));
    }
    return rpc<unknown>("start_attempt", {
      p_quiz_id: quizId,
      p_class: studentClass || null,
    });
  },
  saveAttempt: async (params: {
    attemptId: string;
    revision: number;
    answers: Record<string, OptionId[]>;
    flaggedQuestionIds: string[];
    currentQuestionIndex: number;
    mutationId: string;
    clientSequence: number;
    writerSessionId: string;
  }) => {
    if (isQizzoneApiConfigured) {
      return mapApiAttempt(await qizzoneApi<ApiExamAttempt>(`/api/v1/exam-attempts/${params.attemptId}/autosave`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': params.mutationId },
        body: JSON.stringify({
          revision: params.revision,
          answers: params.answers,
          flaggedQuestionIds: params.flaggedQuestionIds,
          currentQuestionIndex: params.currentQuestionIndex,
          mutationId: params.mutationId,
          clientSequence: params.clientSequence,
          writerSessionId: params.writerSessionId,
        }),
      }));
    }
    return rpc<unknown>("save_attempt", {
      p_id: params.attemptId,
      p_revision: params.revision,
      p_answers: params.answers,
      p_flags: params.flaggedQuestionIds,
      p_index: params.currentQuestionIndex,
    });
  },
  submitAttempt: (attemptId: string) => isQizzoneApiConfigured
    ? qizzoneApi<ExamResult>(`/api/v1/exam-attempts/${attemptId}/submit`, { method: 'POST' })
    : rpc<ExamResult>("submit_attempt", { p_id: attemptId }),
  finalizeExpired: () => isQizzoneApiConfigured
    ? qizzoneApi<void>('/api/v1/exam-attempts/finalize-expired', { method: 'POST' })
    : rpc<void>("finalize_expired"),
};
