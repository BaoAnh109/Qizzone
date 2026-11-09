export function getRetryableWrongQuestions<T extends { checked: boolean; isCorrect: boolean }>(details: readonly T[]): T[] {
  return details.filter(detail => detail.checked && !detail.isCorrect);
}

export function practiceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'Dịch vụ luyện tập phản hồi quá lâu. Vui lòng thử lại.';
  }
  if (error instanceof Error && /failed to fetch|network error|connection|timed out|timeout/i.test(error.message)) {
    return 'Không thể kết nối dịch vụ luyện tập. Hãy kiểm tra mạng rồi thử lại.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
