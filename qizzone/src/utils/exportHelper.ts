import type { ExamResult } from "@/types/exam";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}p ${secs < 10 ? "0" : ""}${secs}s`;
}

function escapeCsvField(field: string | number | undefined): string {
  if (field === undefined || field === null) return '""';
  const str = String(field);
  // If field contains comma, quote, or newline, escape it
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function exportResultsToCsv(params: {
  quizTitle: string;
  roomCode: string;
  subject: string;
  results: ExamResult[];
}): void {
  const { quizTitle, roomCode, subject, results } = params;

  const headers = [
    "STT",
    "Họ và tên thí sinh",
    "Lớp",
    "Mã phòng",
    "Môn học",
    "Điểm số (/10)",
    "Số câu đúng",
    "Tổng số câu",
    "Tỉ lệ đúng (%)",
    "Xếp loại",
    "Kết quả",
    "Thời gian làm bài",
    "Thời điểm nộp bài",
  ];

  const rows = results.map((r, idx) => [
    idx + 1,
    r.studentName,
    r.studentClass || "12A1",
    r.roomCode || roomCode,
    r.subject || subject,
    r.score.toFixed(2),
    r.correctCount,
    r.totalQuestions,
    `${r.percentage}%`,
    r.academicRank || (r.score >= 8 ? "Giỏi" : r.score >= 6.5 ? "Khá" : r.score >= 5 ? "Trung bình" : "Yếu"),
    r.isPassed ? "ĐẠT" : "CHƯA ĐẠT",
    formatDuration(r.timeSpentSeconds),
    new Date(r.submittedAt).toLocaleString("vi-VN"),
  ]);

  // Construct CSV content with UTF-8 BOM
  const csvContent =
    "\uFEFF" +
    [headers.join(","), ...rows.map((row) => row.map(escapeCsvField).join(","))].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  // Clean filename
  const cleanTitle = quizTitle
    .replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, "_")
    .substring(0, 40);
  const dateStr = new Date().toISOString().split("T")[0];
  const filename = `BangDiem_${cleanTitle}_${dateStr}.csv`;

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
