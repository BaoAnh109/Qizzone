import { describe, expect, it } from 'vitest';
import { getRetryableWrongQuestions, practiceErrorMessage } from '@/utils/practice';

describe('getRetryableWrongQuestions', () => {
  it('includes checked wrong answers and excludes skipped or correct answers', () => {
    const checkedWrong = { questionId: 'wrong', checked: true, isCorrect: false };
    const skipped = { questionId: 'skipped', checked: false, isCorrect: false };
    const checkedCorrect = { questionId: 'correct', checked: true, isCorrect: true };

    expect(getRetryableWrongQuestions([checkedWrong, skipped, checkedCorrect])).toEqual([checkedWrong]);
  });
});

describe('practiceErrorMessage', () => {
  it('shows a Vietnamese message for network failures and preserves server validation messages', () => {
    expect(practiceErrorMessage(new Error('Failed to fetch'), 'Fallback')).toMatch(/Không thể kết nối/i);
    expect(practiceErrorMessage(new Error('Đề đã đóng'), 'Fallback')).toBe('Đề đã đóng');
    expect(practiceErrorMessage(null, 'Không thể tải dữ liệu')).toBe('Không thể tải dữ liệu');
  });
});
