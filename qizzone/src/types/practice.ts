import type { OptionId, OptionItem, QuestionType } from '@/types/quiz';

export type PracticeSessionStatus = 'in_progress' | 'completed' | 'invalidated';

export interface PracticeSetup {
  /** null means use every question in the published quiz. */
  questionCount: number | null;
  showExplanation: boolean;
}

export interface PracticeAnswer {
  questionId: string;
  selectedAnswers: OptionId[];
  isCorrect: boolean;
  correctAnswers: OptionId[];
  explanation?: string | null;
  checkedAt?: string;
  locked: true;
}

export interface PracticeSession {
  id: string;
  quizId: string;
  quizTitle: string;
  subject: string;
  studentId: string;
  startedAt: string;
  status: PracticeSessionStatus;
  questionOrder: string[];
  optionOrder: Record<string, OptionId[]>;
  showExplanation: boolean;
  answers: Record<string, OptionId[]>;
  checkedAnswers: Record<string, PracticeAnswer>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
}

export interface PracticeResultDetail {
  questionId: string;
  order: number;
  content: string;
  type: QuestionType;
  options: OptionItem[];
  optionOrder: OptionId[];
  selectedAnswers: OptionId[];
  correctAnswers: OptionId[];
  isCorrect: boolean;
  checked: boolean;
  explanation: string;
}

export interface PracticeResult {
  id: string;
  sessionId: string;
  quizId: string;
  quizTitle: string;
  subject: string;
  studentId: string;
  startedAt: string;
  finishedAt: string;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  percentage: number;
  durationSeconds: number;
  details: PracticeResultDetail[];
}

export interface PracticeHistoryItem {
  id: string;
  sessionId: string;
  quizId: string;
  quizTitle: string;
  subject: string;
  startedAt: string;
  finishedAt: string | null;
  status: PracticeSessionStatus;
  message?: string | null;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  percentage: number;
  durationSeconds: number;
}

export type PracticeOpenResult =
  | { status: 'in_progress'; session: PracticeSession }
  | { status: 'completed' }
  | { status: 'invalidated'; message: string }
  | { status: 'error'; message: string };
