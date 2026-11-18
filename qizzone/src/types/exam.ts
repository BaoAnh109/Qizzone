import type { OptionId, OptionItem } from "./quiz";

export type AcademicRank = "Xuất sắc" | "Giỏi" | "Khá" | "Trung bình" | "Yếu";

export interface StudentAnswer {
  questionId: string;
  selectedAnswers: OptionId[];
  isFlagged: boolean;
  timeSpentSeconds?: number;
}

export interface ExamSession {
  quizId: string;
  studentId: string;
  studentName: string;
  studentClass?: string;
  startTime: number; // timestamp
  endTime: number; // timestamp
  durationMinutes: number; // 0 = unlimited
  answers: Record<string, OptionId[]>; // questionId -> OptionId[]
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  isSubmitted: boolean;
  lastSavedAt: string;
}

export interface QuestionGradingDetail {
  questionId: string;
  order: number;
  content: string;
  images?: string[];
  options: OptionItem[];
  selectedAnswers: OptionId[];
  correctAnswers: OptionId[];
  isCorrect: boolean;
  pointsEarned: number;
  maxPoints: number;
  explanation?: string;
}

export interface ExamResult {
  id: string; // resultId (e.g. res-xxx)
  quizId: string;
  quizTitle: string;
  subject: string;
  roomCode: string;
  studentId: string;
  studentName: string;
  studentClass?: string;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  score: number; // Thang điểm 10 (làm tròn 2 chữ số)
  totalPointsEarned: number;
  maxTotalPoints: number;
  percentage: number;
  isPassed: boolean;
  passPercentage: number;
  academicRank: AcademicRank;
  timeSpentSeconds: number;
  details: QuestionGradingDetail[];
  flaggedQuestionIds?: string[];
  submittedAt: string;
}

export interface QuizReportQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: "all" | "passed" | "failed";
  sortBy?: "submitted_desc" | "score_asc" | "score_desc";
  includeQuestionAnalytics?: boolean;
}

export interface QuizReportSummary {
  totalSubmissions: number;
  gradedSubmissions: number;
  ungradedSubmissions: number;
  averageScore: number;
  maxScore: number;
  minScore: number;
  passedCount: number;
  passRate: number;
}

export interface QuizQuestionAnalytics {
  questionId: string;
  order: number;
  content: string;
  options: OptionItem[];
  attemptCount: number;
  answeredCount: number;
  correctCount: number;
  skippedCount: number;
  accuracyPercent: number;
  optionCounts: Record<OptionId, number>;
}

export interface QuizResultsReport {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  summary: QuizReportSummary;
  questionAnalytics: QuizQuestionAnalytics[];
  items: ExamResult[];
}
