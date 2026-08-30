export type QuestionType = "single_choice" | "multiple_choice" | "true_false";

export type OptionId = "A" | "B" | "C" | "D";

export interface OptionItem {
  id: OptionId;
  content: string; // Supports raw text + inline LaTeX $...$ or block $$...$$
}

export interface Question {
  id: string;
  order: number;
  content: string; // Question prompt (supports KaTeX)
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
