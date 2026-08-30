import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Quiz, QuizStatus, Question } from "@/types/quiz";

const DEFAULT_QUIZZES: Quiz[] = [
  {
    id: "quiz-001",
    title: "Kiểm tra Giải tích 12: Đạo hàm & Ứng dụng hình học",
    subject: "Toán học 12",
    description: "Đề kiểm tra trắc nghiệm 1 tiết có hỗ trợ công thức Toán LaTeX và đồ thị hàm số.",
    teacherId: "user-tea-001",
    teacherName: "Thầy Nguyễn Văn Anh",
    code: "QZ9821",
    status: "published",
    settings: {
      durationMinutes: 45,
      shuffleQuestions: false,
      shuffleOptions: true,
      allowReview: true,
      maxAttempts: 2,
      passPercentage: 50,
    },
    totalQuestions: 4,
    totalPoints: 10,
    createdAt: "2026-08-28T08:30:00.000Z",
    updatedAt: "2026-08-30T09:00:00.000Z",
    questions: [
      {
        id: "q-01",
        order: 1,
        content: "Cho hàm số $f(x) = x^3 - 3x + 2$. Điểm cực tiểu của đồ thị hàm số là điểm nào sau đây?",
        type: "single_choice",
        options: [
          { id: "A", content: "$A(-1; 4)$" },
          { id: "B", content: "$B(1; 0)$" },
          { id: "C", content: "$C(0; 2)$" },
          { id: "D", content: "$D(2; 4)$" },
        ],
        correctAnswers: ["B"],
        explanation: "Ta có đạo hàm $f'(x) = 3x^2 - 3 = 0 \\Leftrightarrow x = \\pm 1$. Bảng biến thiên cho thấy hàm số đạt cực tiểu tại $x = 1 \\Rightarrow y(1) = 0$. Vậy tọa độ điểm cực tiểu là $B(1; 0)$.",
        points: 2.5,
      },
      {
        id: "q-02",
        order: 2,
        content: "Tính tích phân $I = \\int_{0}^{1} (2x + 1)e^x dx$ ta được kết quả có dạng $a \\cdot e + b$. Tính giá trị của $S = a + b$.",
        type: "single_choice",
        options: [
          { id: "A", content: "$S = 1$" },
          { id: "B", content: "$S = 2$" },
          { id: "C", content: "$S = 0$" },
          { id: "D", content: "$S = -1$" },
        ],
        correctAnswers: ["A"],
        explanation: "Sử dụng phương pháp từng phần: đặt $u = 2x+1 \\Rightarrow du = 2dx$; $dv = e^x dx \\Rightarrow v = e^x$. Suy ra $I = (2x+1)e^x\\Big|_0^1 - 2\\int_0^1 e^x dx = 3e - 1 - 2(e-1) = e + 1$. Do đó $a=1, b=1 \\Rightarrow S = 2$.",
        points: 2.5,
      },
      {
        id: "q-03",
        order: 3,
        content: "Đường tiệm cận đứng và tiệm cận ngang của đồ thị hàm số $y = \\frac{2x - 1}{x + 1}$ lần lượt là:",
        type: "single_choice",
        options: [
          { id: "A", content: "$x = -1$ và $y = 2$" },
          { id: "B", content: "$x = 1$ và $y = 2$" },
          { id: "C", content: "$x = -1$ và $y = -1$" },
          { id: "D", content: "$x = 2$ và $y = -1$" },
        ],
        correctAnswers: ["A"],
        explanation: "Ta có $\\lim_{x \\to -1^+} y = -\\infty \\Rightarrow$ Tiệm cận đứng $x = -1$. $\\lim_{x \\to \\pm\\infty} y = 2 \\Rightarrow$ Tiệm cận ngang $y = 2$.",
        points: 2.5,
      },
      {
        id: "q-04",
        order: 4,
        content: "Tìm tập xác định của hàm số $y = \\sqrt{4 - x^2} + \\log_2(x + 1)$:",
        type: "single_choice",
        options: [
          { id: "A", content: "$D = (-1; 2]$" },
          { id: "B", content: "$D = [-2; 2]$" },
          { id: "C", content: "$D = (-1; 2)$" },
          { id: "D", content: "$D = [0; 2]$" },
        ],
        correctAnswers: ["A"],
        explanation: "Điều kiện: $\\begin{cases} 4 - x^2 \\ge 0 \\\\ x + 1 > 0 \\end{cases} \\Leftrightarrow \\begin{cases} -2 \\le x \\le 2 \\\\ x > -1 \\end{cases} \\Leftrightarrow -1 < x \\le 2$. Tập xác định là $D = (-1; 2]$.",
        points: 2.5,
      },
    ],
  },
  {
    id: "quiz-002",
    title: "Ôn tập Vật lý 10: Chuyển động biến đổi & Định luật II Newton",
    subject: "Vật lý 10",
    description: "Bộ câu hỏi trắc nghiệm rèn luyện kỹ năng tính toán động lực học chất điểm.",
    teacherId: "user-tea-001",
    teacherName: "Thầy Nguyễn Văn Anh",
    code: "QZ7734",
    status: "published",
    settings: {
      durationMinutes: 30,
      shuffleQuestions: true,
      shuffleOptions: true,
      allowReview: true,
      maxAttempts: 1,
      passPercentage: 60,
    },
    totalQuestions: 2,
    totalPoints: 10,
    createdAt: "2026-08-29T14:15:00.000Z",
    updatedAt: "2026-08-30T08:00:00.000Z",
    questions: [
      {
        id: "q-phys-01",
        order: 1,
        content: "Một vật có khối lượng $m = 2\\text{ kg}$ bắt đầu chuyển động thẳng nhanh dần đều dưới tác dụng của lực kéo $F = 6\\text{ N}$. Vận tốc của vật sau $t = 4\\text{ s}$ là:",
        type: "single_choice",
        options: [
          { id: "A", content: "$v = 12\\text{ m/s}$" },
          { id: "B", content: "$v = 8\\text{ m/s}$" },
          { id: "C", content: "$v = 6\\text{ m/s}$" },
          { id: "D", content: "$v = 24\\text{ m/s}$" },
        ],
        correctAnswers: ["A"],
        explanation: "Gia tốc: $a = \\frac{F}{m} = \\frac{6}{2} = 3\\text{ m/s}^2$. Vận tốc sau 4s: $v = v_0 + a \\cdot t = 0 + 3 \\cdot 4 = 12\\text{ m/s}$.",
        points: 5,
      },
      {
        id: "q-phys-02",
        order: 2,
        content: "Công thức liên hệ giữa vận tốc, gia tốc và quãng đường trong chuyển động biến đổi đều là:",
        type: "single_choice",
        options: [
          { id: "A", content: "$v^2 - v_0^2 = 2as$" },
          { id: "B", content: "$v - v_0 = 2as$" },
          { id: "C", content: "$v^2 + v_0^2 = 2as$" },
          { id: "D", content: "$s = v \\cdot t + \\frac{1}{2}at$" },
        ],
        correctAnswers: ["A"],
        explanation: "Công thức độc lập thời gian: $v^2 - v_0^2 = 2as$.",
        points: 5,
      },
    ],
  },
  {
    id: "quiz-003",
    title: "Kiểm tra Hóa học 12: Hợp chất Hữu cơ chứa Nitơ (Amin - Amino Axit)",
    subject: "Hóa học 12",
    description: "Đề thi thử bản nháp chuẩn bị cho tuần sau.",
    teacherId: "user-tea-001",
    teacherName: "Thầy Nguyễn Văn Anh",
    code: "QZ1045",
    status: "draft",
    settings: {
      durationMinutes: 40,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowReview: true,
      maxAttempts: 1,
      passPercentage: 50,
    },
    totalQuestions: 1,
    totalPoints: 10,
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    questions: [
      {
        id: "q-chem-01",
        order: 1,
        content: "Chất nào sau đây là amino axit đơn giản nhất có công thức phân tử $\\text{C}_2\\text{H}_5\\text{O}_2\\text{N}$?",
        type: "single_choice",
        options: [
          { id: "A", content: "Glyxin ($\\text{H}_2\\text{N}-\\text{CH}_2-\\text{COOH}$)" },
          { id: "B", content: "Alanin ($\\text{CH}_3-\\text{CH}(\\text{NH}_2)-\\text{COOH}$)" },
          { id: "C", content: "Valin" },
          { id: "D", content: "Axit glutamic" },
        ],
        correctAnswers: ["A"],
        explanation: "Glyxin có công thức phân tử là $\\text{C}_2\\text{H}_5\\text{O}_2\\text{N}$, $M = 75\\text{ g/mol}$.",
        points: 10,
      },
    ],
  },
];

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "QZ";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

interface QuizStoreState {
  quizzes: Quiz[];
  isLoading: boolean;

  // Actions
  getQuizById: (id: string) => Quiz | undefined;
  getQuizByCode: (code: string) => Quiz | undefined;
  createQuiz: (data: Omit<Quiz, "id" | "createdAt" | "updatedAt">) => Quiz;
  updateQuiz: (id: string, data: Partial<Quiz>) => Quiz;
  deleteQuiz: (id: string) => void;
  togglePublishStatus: (id: string) => Quiz;
  duplicateQuiz: (id: string) => Quiz;
  generateUniqueRoomCode: () => string;
}

export const useQuizStore = create<QuizStoreState>()(
  persist(
    (set, get) => ({
      quizzes: DEFAULT_QUIZZES,
      isLoading: false,

      getQuizById: (id: string) => {
        return get().quizzes.find((q) => q.id === id);
      },

      getQuizByCode: (code: string) => {
        const cleanCode = code.trim().toUpperCase();
        return get().quizzes.find(
          (q) => q.code.toUpperCase() === cleanCode
        );
      },

      generateUniqueRoomCode: () => {
        let code = generateRoomCode();
        const existing = get().quizzes.map((q) => q.code.toUpperCase());
        while (existing.includes(code)) {
          code = generateRoomCode();
        }
        return code;
      },

      createQuiz: (data) => {
        const id = `quiz-${Date.now().toString(36)}`;
        const code = data.code || get().generateUniqueRoomCode();
        const now = new Date().toISOString();

        const newQuiz: Quiz = {
          ...data,
          id,
          code,
          totalQuestions: data.questions.length,
          totalPoints: data.questions.reduce((sum, q) => sum + (q.points || 1), 0),
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          quizzes: [newQuiz, ...state.quizzes],
        }));

        return newQuiz;
      },

      updateQuiz: (id, data) => {
        const now = new Date().toISOString();
        let updatedQuiz: Quiz | undefined;

        set((state) => ({
          quizzes: state.quizzes.map((q) => {
            if (q.id === id) {
              const updatedQuestions = data.questions || q.questions;
              updatedQuiz = {
                ...q,
                ...data,
                questions: updatedQuestions,
                totalQuestions: updatedQuestions.length,
                totalPoints: updatedQuestions.reduce(
                  (sum, item) => sum + (item.points || 1),
                  0
                ),
                updatedAt: now,
              };
              return updatedQuiz;
            }
            return q;
          }),
        }));

        if (!updatedQuiz) throw new Error("Không tìm thấy đề thi cần cập nhật");
        return updatedQuiz;
      },

      deleteQuiz: (id) => {
        set((state) => ({
          quizzes: state.quizzes.filter((q) => q.id !== id),
        }));
      },

      togglePublishStatus: (id) => {
        const quiz = get().getQuizById(id);
        if (!quiz) throw new Error("Không tìm thấy đề thi");

        const newStatus: QuizStatus =
          quiz.status === "published" ? "draft" : "published";

        return get().updateQuiz(id, { status: newStatus });
      },

      duplicateQuiz: (id) => {
        const source = get().getQuizById(id);
        if (!source) throw new Error("Không tìm thấy đề thi mẫu");

        const newCode = get().generateUniqueRoomCode();
        const duplicatedQuestions: Question[] = source.questions.map((q, idx) => ({
          ...q,
          id: `q-${Date.now().toString(36)}-${idx}`,
        }));

        return get().createQuiz({
          ...source,
          title: `${source.title} (Bản sao)`,
          code: newCode,
          status: "draft",
          questions: duplicatedQuestions,
        });
      },
    }),
    {
      name: "qizzone_quizzes_db",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

export default useQuizStore;
