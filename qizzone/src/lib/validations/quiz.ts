import { z } from "zod";

export const optionSchema = z.object({
  id: z.enum(["A", "B", "C", "D"]),
  content: z.string().min(1, "Nội dung đáp án không được để trống"),
});

export const questionSchema = z
  .object({
    id: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
    content: z.string().min(1, "Nội dung câu hỏi không được để trống"),
    type: z.enum(["single_choice", "multiple_choice", "true_false"]).default("single_choice"),
    options: z
      .array(optionSchema)
      .min(2, "Mỗi câu hỏi phải có ít nhất 2 đáp án")
      .max(4, "Tối đa 4 đáp án"),
    correctAnswers: z
      .array(z.enum(["A", "B", "C", "D"]))
      .min(1, "Vui lòng chọn ít nhất 1 đáp án đúng"),
    explanation: z.string().optional(),
    points: z.number().positive("Điểm số phải lớn hơn 0").default(1),
  })
  .refine(
    (data) => {
      // Validate that selected correctAnswers exist in options
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
  maxAttempts: z.number().int().min(1).default(1),
  passPercentage: z.number().min(0).max(100).default(50),
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
