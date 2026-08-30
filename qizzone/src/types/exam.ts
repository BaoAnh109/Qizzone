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
  submittedAt: string;
}
