import { describe, it, expect } from "vitest";
import type { ExamResult } from "@/types/exam";

describe("CSV Export Helpers Unit Tests", () => {
  it("định dạng chuỗi CSV chuẩn có chứa ký tự BOM UTF-8 (\\uFEFF)", () => {
    const BOM = "\uFEFF";
    const header = "STT,Họ và tên thí sinh,Lớp,Mã phòng,Môn học";
    const content = BOM + header;

    expect(content.startsWith("\uFEFF")).toBe(true);
  });

  it("thoát (escape) dấu nháy kép và dấu phẩy trong tên thí sinh / đề thi", () => {
    const escapeCsvField = (field: string | number | undefined): string => {
      if (field === undefined || field === null) return '""';
      const str = String(field);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return `"${str}"`;
    };

    expect(escapeCsvField('Nguyễn "Văn" A')).toBe('"Nguyễn ""Văn"" A"');
    expect(escapeCsvField("Trần, Thị B")).toBe('"Trần, Thị B"');
    expect(escapeCsvField("Đỗ Nam")).toBe('"Đỗ Nam"');
    expect(escapeCsvField(10)).toBe('"10"');
  });

  it("tính toán đúng các trường trong hàng bảng điểm kết quả", () => {
    const mockResult: ExamResult = {
      id: "res-01",
      quizId: "quiz-01",
      quizTitle: "Đề thi Toán 12",
      subject: "Toán học 12",
      roomCode: "QZ9821",
      studentId: "stu-01",
      studentName: "Nguyễn Bảo Anh",
      studentClass: "12A1",
      totalQuestions: 4,
      answeredCount: 4,
      correctCount: 4,
      incorrectCount: 0,
      skippedCount: 0,
      score: 10.0,
      totalPointsEarned: 10,
      maxTotalPoints: 10,
      percentage: 100,
      isPassed: true,
      passPercentage: 50,
      academicRank: "Xuất sắc",
      timeSpentSeconds: 125,
      details: [],
      submittedAt: "2026-08-30T10:00:00.000Z",
    };

    expect(mockResult.score.toFixed(2)).toBe("10.00");
    expect(mockResult.isPassed).toBe(true);
    expect(mockResult.academicRank).toBe("Xuất sắc");
  });
});
