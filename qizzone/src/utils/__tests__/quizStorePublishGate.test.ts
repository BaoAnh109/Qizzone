import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock service trước khi import store: gate bước 08 phải chặn TRƯỚC
// khi chạm RPC — nếu mock vẫn bị gọi nghĩa là gate không hoạt động.
const mocks = vi.hoisted(() => ({
  save: vi.fn(async () => "quiz-new"),
  setStatus: vi.fn(async () => undefined),
  // Kiểu tường minh để mockResolvedValue nhận mảng quiz giả lập
  // (vi.fn(async () => []) sẽ suy ra Promise<never[]> và lỗi type).
  list: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("@/services/quizService", () => ({
  quizService: {
    save: mocks.save,
    setStatus: mocks.setStatus,
    list: mocks.list,
    delete: vi.fn(),
    setAssignments: vi.fn(),
  },
}));

import { useQuizStore } from "@/store/quizStore";

const validQ = (overrides: Record<string, unknown> = {}) => ({
  id: "q1",
  order: 1,
  content: "2 + 2 = ?",
  type: "single_choice" as const,
  options: [
    { id: "A" as const, content: "3" },
    { id: "B" as const, content: "4" },
  ],
  correctAnswers: ["B" as const],
  points: 1,
  ...overrides,
});

const baseQuiz = (overrides: Record<string, unknown> = {}) => ({
  id: "quiz-1",
  title: "Đề thử",
  subject: "Toán",
  teacherId: "teacher-1",
  code: "QZ0001",
  status: "draft" as const,
  settings: {
    durationMinutes: 45,
    shuffleQuestions: false,
    shuffleOptions: false,
    allowReview: true,
    maxAttempts: 0,
    passPercentage: 50,
  },
  questions: [validQ()],
  totalQuestions: 1,
  totalPoints: 1,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  ...overrides,
});

describe("Bước 08: choke point xuất bản ở quizStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQuizStore.setState({ quizzes: [], isLoading: false, error: null });
  });

  it("createQuiz published với câu thiếu đáp án: throw, KHÔNG gọi save", async () => {
    mocks.list.mockResolvedValue([]);
    await expect(
      useQuizStore.getState().createQuiz({
        ...baseQuiz(),
        status: "published",
        questions: [validQ({ correctAnswers: [] })],
      } as unknown as import("@/services/quizService").QuizInput)
    ).rejects.toThrow(/Không thể xuất bản/);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("createQuiz draft với câu thiếu đáp án: qua gate (không throw vì gate), tới RPC", async () => {
    // Draft qua gate ở tầng store; DB thật có thể từ chối sau đó (ghi
    // rõ trong PROGRESS) — ở đây mock save thành công để chứng minh
    // gate draft không chặn.
    mocks.list.mockResolvedValue([baseQuiz({ id: "quiz-new" })]);
    const created = await useQuizStore.getState().createQuiz({
      ...baseQuiz(),
      status: "draft",
      questions: [validQ({ correctAnswers: [] })],
    } as unknown as import("@/services/quizService").QuizInput);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(created.id).toBe("quiz-new");
  });

  it("togglePublishStatus draft → published với câu thiếu đáp án: throw, KHÔNG gọi setStatus", async () => {
    useQuizStore.setState({
      quizzes: [
        baseQuiz({ questions: [validQ({ correctAnswers: [] })] }),
      ],
    });
    await expect(
      useQuizStore.getState().togglePublishStatus("quiz-1")
    ).rejects.toThrow(/Không thể xuất bản/);
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("togglePublishStatus draft → published với bộ sạch: gọi setStatus published", async () => {
    useQuizStore.setState({ quizzes: [baseQuiz()] });
    mocks.list.mockResolvedValue([baseQuiz({ status: "published" })]);
    await useQuizStore.getState().togglePublishStatus("quiz-1");
    expect(mocks.setStatus).toHaveBeenCalledWith("quiz-1", "published");
  });

  it("togglePublishStatus published → closed: không cần gate, gọi setStatus closed", async () => {
    useQuizStore.setState({
      quizzes: [
        baseQuiz({
          status: "published",
          questions: [validQ({ correctAnswers: [] })],
        }),
      ],
    });
    mocks.list.mockResolvedValue([baseQuiz({ status: "closed" })]);
    await useQuizStore.getState().togglePublishStatus("quiz-1");
    expect(mocks.setStatus).toHaveBeenCalledWith("quiz-1", "closed");
  });

  it("updateQuiz lật nháp thiếu đáp án sang published: throw, KHÔNG gọi save", async () => {
    useQuizStore.setState({
      quizzes: [
        baseQuiz({ questions: [validQ({ correctAnswers: [] })] }),
      ],
    });
    await expect(
      useQuizStore.getState().updateQuiz("quiz-1", { status: "published" })
    ).rejects.toThrow(/Không thể xuất bản/);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
