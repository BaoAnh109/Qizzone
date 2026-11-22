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
  assignmentId?: string | null;
  classroomId?: string | null;
  dueAtSnapshot?: string | null;
  isLate?: boolean;
  lateSeconds?: number;
  startTime: number; // timestamp
  endTime: number; // timestamp
  durationMinutes: number; // 0 = unlimited
  answers: Record<string, OptionId[]>; // questionId -> OptionId[]
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  isSubmitted: boolean;
  lastSavedAt: string;
  tabSwitchCount?: number;
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
  assignmentId?: string | null;
  classroomId?: string | null;
  dueAtSnapshot?: string | null;
  isLate?: boolean;
  lateSeconds?: number;
  scoreHidden?: boolean;
  answersHidden?: boolean;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number | null;
  incorrectCount: number | null;
  skippedCount: number;
  score: number | null; // Thang điểm 10 (làm tròn 2 chữ số), null khi scoreHidden = true
  totalPointsEarned: number | null;
  maxTotalPoints: number;
  percentage: number | null;
  isPassed: boolean | null;
  passPercentage: number;
  academicRank: AcademicRank | null;
  timeSpentSeconds: number;
  details: QuestionGradingDetail[];
  flaggedQuestionIds?: string[];
  submittedAt: string;
  tabSwitchCount?: number;
}
