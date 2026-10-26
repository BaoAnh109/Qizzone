import { describe, expect, it } from 'vitest';
import { practiceErrorMessage } from '@/utils/practice';

describe('practiceErrorMessage', () => {
  it('shows a Vietnamese message for network failures and preserves server validation messages', () => {
    expect(practiceErrorMessage(new Error('Failed to fetch'), 'Fallback')).toMatch(/Không thể kết nối/i);
    expect(practiceErrorMessage(new Error('Đề đã đóng'), 'Fallback')).toBe('Đề đã đóng');
    expect(practiceErrorMessage(null, 'Không thể tải dữ liệu')).toBe('Không thể tải dữ liệu');
  });
});
