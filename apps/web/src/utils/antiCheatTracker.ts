import type { ExamResult } from "@/types/exam";

const ATTEMPT_PREFIX = "qizzone:anticheat:attempt:";
const RESULT_PREFIX = "qizzone:anticheat:result:";

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readCount(key: string): number {
  try {
    const raw = safeStorage()?.getItem(key);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeCount(key: string, count: number): void {
  try {
    safeStorage()?.setItem(key, String(Math.max(0, Math.floor(count))));
  } catch {
    // Ignore storage quota or private-mode errors.
  }
}

export function getAttemptTabSwitchCount(studentId: string, quizId: string): number {
  if (!studentId || !quizId) return 0;
  return readCount(`${ATTEMPT_PREFIX}${studentId}:${quizId}`);
}

export function incrementAttemptTabSwitchCount(studentId: string, quizId: string): number {
  if (!studentId || !quizId) return 0;
  const key = `${ATTEMPT_PREFIX}${studentId}:${quizId}`;
  const next = readCount(key) + 1;
  writeCount(key, next);
  return next;
}

export function clearAttemptTabSwitchCount(studentId: string, quizId: string): void {
  if (!studentId || !quizId) return;
  try {
    safeStorage()?.removeItem(`${ATTEMPT_PREFIX}${studentId}:${quizId}`);
  } catch {
    // Ignore storage removal errors.
  }
}

export function recordResultTabSwitchCount(
  resultId: string,
  quizId: string,
  studentId: string,
  count: number
): void {
  if (!resultId) return;
  writeCount(`${RESULT_PREFIX}${resultId}`, count);
  if (quizId && studentId) {
    writeCount(`${RESULT_PREFIX}${studentId}:${quizId}`, count);
  }
}

export function getResultTabSwitchCount(
  result: Pick<ExamResult, "id" | "quizId" | "studentId" | "tabSwitchCount">
): number {
  if (typeof result.tabSwitchCount === "number" && Number.isFinite(result.tabSwitchCount)) {
    return Math.max(0, result.tabSwitchCount);
  }
  const byId = readCount(`${RESULT_PREFIX}${result.id}`);
  if (byId > 0) return byId;
  if (result.studentId && result.quizId) {
    return readCount(`${RESULT_PREFIX}${result.studentId}:${result.quizId}`);
  }
  return 0;
}
