import { z } from "zod";

export type QuestionType = "single_choice" | "multiple_choice" | "true_false";

export const OPTION_IDS = ["A", "B", "C", "D", "E"] as const;
export type OptionId = (typeof OPTION_IDS)[number];

export interface OptionItem {
  id: OptionId;
  content: string; // Supports raw text + inline LaTeX $...$ or block $$...$$
  images?: string[];
}

export interface Question {
  id: string;
  order: number;
  content: string; // Question prompt (supports KaTeX)
  images?: string[];
  type: QuestionType;
  options: OptionItem[];
  correctAnswers: OptionId[];
  explanation?: string; // Step-by-step solution / explanation
  points: number; // Default 1
}

export interface QuizSettings {
  durationMinutes: number; // Exam duration in minutes
  shuffleQuestions: boolean; // Randomize question order
  shuffleOptions: boolean; // Randomize options order
  allowReview: boolean; // Allow students to review answers after submit
  maxAttempts: number; // Maximum attempts allowed (default 1)
  passPercentage: number; // Passing score percentage (default 50%)
  practiceEnabled?: boolean; // Whether students can use this published quiz for practice (defaults to true)
  assignedClasses?: string[]; // Target classes (e.g. ["12A1", "12A2"])
  assignedEmails?: string[]; // Target student emails (e.g. ["student1@gmail.com"])
}

export type QuizStatus = "draft" | "published" | "closed";

export interface Quiz {
  id: string;
  title: string;
  subject: string;
  description?: string;
  teacherId: string;
  teacherName?: string;
  code: string; // 6-character room code (e.g. QZ9821)
  status: QuizStatus;
  settings: QuizSettings;
  questions: Question[];
  totalQuestions: number;
  totalPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuizDTO {
  title: string;
  subject: string;
  description?: string;
  settings: QuizSettings;
  questions: Omit<Question, "id" | "order">[];
  status?: QuizStatus;
}

export const optionSchema = z.object({
  id: z.enum(OPTION_IDS),
  content: z.string().min(1, "Nội dung đáp án không được để trống"),
  images: z.array(z.string()).max(8).optional(),
});

export const questionSchema = z
  .object({
    id: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
    content: z.string().min(1, "Nội dung câu hỏi không được để trống"),
    images: z.array(z.string()).max(8).optional(),
    type: z.enum(["single_choice", "multiple_choice", "true_false"]).default("single_choice"),
    options: z
      .array(optionSchema)
      .min(2, "Mỗi câu hỏi phải có ít nhất 2 đáp án")
      .max(5, "Tối đa 5 đáp án"),
    correctAnswers: z
      .array(z.enum(OPTION_IDS))
      .min(1, "Vui lòng chọn ít nhất 1 đáp án đúng"),
    explanation: z.string().optional(),
    points: z.number().positive("Điểm số phải lớn hơn 0").default(1),
  })
  .refine(
    (data) => {
      const availableOptionIds = data.options.map((o) => o.id);
      return data.correctAnswers.every((ans) => availableOptionIds.includes(ans));
    },
    {
      message: "Đáp án đúng phải nằm trong danh sách các lựa chọn",
      path: ["correctAnswers"],
    }
  );

export const quizSettingsSchema = z.object({
  durationMinutes: z
    .number({ message: "Vui lòng nhập thời gian hợp lệ" })
    .int("Thời gian phải là số nguyên")
    .min(0, "Thời gian tối thiểu là 0 phút (0 = Không giới hạn)")
    .max(300, "Thời gian tối đa là 300 phút"),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  allowReview: z.boolean().default(true),
  maxAttempts: z
    .number({ message: "Vui lòng nhập số lần làm bài hợp lệ" })
    .int("Số lần làm bài phải là số nguyên")
    .min(0, "Số lần làm bài tối thiểu là 0 (0 = Vô hạn)")
    .default(0),
  passPercentage: z.number().min(0).max(100).default(50),
  practiceEnabled: z.boolean().default(true),
  assignedClasses: z.array(z.string()).optional().default([]),
  assignedEmails: z.array(z.string()).optional().default([]),
});

export const quizSchema = z.object({
  title: z
    .string()
    .min(1, "Vui lòng nhập tiêu đề đề thi")
    .max(200, "Tiêu đề tối đa 200 ký tự"),
  subject: z
    .string()
    .min(1, "Vui lòng nhập hoặc chọn môn học"),
  description: z.string().optional(),
  settings: quizSettingsSchema,
  questions: z
    .array(questionSchema)
    .min(1, "Bài thi phải có ít nhất 1 câu hỏi"),
  status: z.enum(["draft", "published", "closed"]).default("draft"),
});

export type QuizFormData = z.infer<typeof quizSchema>;
export type QuestionFormData = z.infer<typeof questionSchema>;
export type QuizSettingsFormData = z.infer<typeof quizSettingsSchema>;
