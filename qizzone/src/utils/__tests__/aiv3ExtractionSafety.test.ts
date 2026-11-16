import { describe, expect, it } from 'vitest';
import { parseSingleQuestionBlock } from '../parsers/ruleExtractor';

describe('AIV3 evidence-first extraction', () => {
  it('preserves a valid 2-option question without inventing C and D', () => {
    const result = parseSingleQuestionBlock('Chọn câu đúng?\nA. Đúng\nB. Sai', 1);
    expect(result?.options.map(option => option.id)).toEqual(['A', 'B']);
    expect(result?.correctAnswers).toEqual([]);
  });

  it('preserves 3 options without reporting a missing D', () => {
    const result = parseSingleQuestionBlock('Chọn câu đúng?\nA. Một\nB. Hai\nC. Ba', 1);
    expect(result?.options.map(option => option.id)).toEqual(['A', 'B', 'C']);
    expect(result?.warningFlags?.join(' ') || '').not.toMatch(/Thiếu đáp án D/);
  });

  it('never invents four placeholder options when parsing fails', () => {
    const result = parseSingleQuestionBlock('Câu hỏi chứa hình ảnh chưa thể nhận diện', 1);
    expect(result?.options).toEqual([]);
    expect(result?.warningFlags?.join(' ')).toMatch(/AI fallback/);
  });

  it('extracts an explicit answer without guessing', () => {
    const result = parseSingleQuestionBlock('Chọn câu đúng?\nA. Một\nB. Hai\nĐáp án: B', 1);
    expect(result?.correctAnswers).toEqual(['B']);
  });
});
