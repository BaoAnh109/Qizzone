import { describe, expect, it } from 'vitest';
import { parseRawExamText, parseSingleQuestionBlock } from '../parsers/ruleExtractor';

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

  it('marks contradictory answer evidence as ambiguous instead of preferring one signal', () => {
    const result = parseSingleQuestionBlock('Chọn câu đúng?\nA. Một\n<u>B. Hai</u>', 1, 'A');
    expect(result?.correctAnswers).toEqual([]);
    expect(result?.answerStatus).toBe('ambiguous');
    expect(result?.detectionStrategy).toBe('unknown');
    expect(result?.warningFlags?.join(' ')).toMatch(/mâu thuẫn/);
  });

  it('does not treat parentheses around an option label as a correct-answer marker', () => {
    const result = parseSingleQuestionBlock('Chọn câu đúng?\n(A) Một\n(B) Hai', 1);
    expect(result?.options.map(option => option.id)).toEqual(['A', 'B']);
    expect(result?.correctAnswers).toEqual([]);
  });

  it('normalizes lowercase and circled option labels without changing source order', () => {
    const lowercase = parseSingleQuestionBlock('Chọn câu đúng?\na) Một\nb) Hai', 1);
    expect(lowercase?.options.map(option => option.id)).toEqual(['A', 'B']);
    const circled = parseSingleQuestionBlock('Chọn câu đúng?\n① Một\n② Hai\n③ Ba', 1);
    expect(circled?.options.map(option => option.id)).toEqual(['A', 'B', 'C']);
    expect(circled?.options.map(option => option.content)).toEqual(['Một', 'Hai', 'Ba']);
  });

  it('does not invent placeholder question text and emits a reviewable coverage report', () => {
    const result = parseSingleQuestionBlock('A. Một\nB. Hai', 1);
    expect(result?.content).toBe('');
    const exam = parseRawExamText('Câu 1: Có câu hỏi?\nA. Một\nB. Hai');
    expect(exam.schemaVersion).toBe('2.0');
    expect(exam.coverage).toEqual({ expectedQuestions: 1, extractedQuestions: 1, sourceQuestionNumbers: [1] });
    expect(exam.questions[0].reviewStatus).toBe('pending');
  });
});
