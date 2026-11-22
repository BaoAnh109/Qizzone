import readXlsxFile, { InvalidInputError } from "read-excel-file/browser";
import type { SheetData } from "read-excel-file/browser";

export const MAX_ROSTER_IMPORT_EMAILS = 500;
export const MAX_ROSTER_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EXPLICIT_EMAIL_HEADER_REGEX = /^(e-?mail|thư\s*điện\s*tử|địa\s*chỉ\s*e-?mail)$/i;
const CONTAINS_EMAIL_HEADER_REGEX = /\bemail\b/i;
const GENERIC_NON_EMAIL_HEADER_REGEX = /^(stt|#|no\.?|họ\s*(và\s*)?tên|tên|lớp|class|ghi\s*chú|note|sđt|điện\s*thoại)$/i;

export interface RosterImportParseResult {
  emails: string[];
  invalidEntries: string[];
  duplicateCount: number;
  totalValidFound: number;
  truncatedCount: number;
  totalRowsScanned: number;
  sourceFormat: "xlsx" | "csv";
}

function isRowEmpty(row: SheetData[number]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

function normalizeCellString(cell: SheetData[number][number]): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell.trim();
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell).trim();
  return "";
}

function isExplicitEmailHeader(text: string): boolean {
  if (!text || text.includes("@")) return false;
  return EXPLICIT_EMAIL_HEADER_REGEX.test(text) || CONTAINS_EMAIL_HEADER_REGEX.test(text);
}

function parseCsvRows(rawText: string): SheetData {
  const cleanText = rawText.replace(/^\uFEFF/, "");
  const lines = cleanText.split(/\r?\n/);
  const firstNonEmpty = lines.find((line) => line.trim().length > 0) ?? "";

  let delimiter: "," | ";" = ",";
  let hasUnquotedComma = false;
  let inQuotes = false;
  for (let i = 0; i < firstNonEmpty.length; i += 1) {
    const ch = firstNonEmpty[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      hasUnquotedComma = true;
      break;
    }
  }
  if (!hasUnquotedComma && firstNonEmpty.includes(";")) {
    delimiter = ";";
  }

  const rows: SheetData = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i += 1) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (insideQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i += 1;
      } else if (ch === '"') {
        insideQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      insideQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell.trim() || "");
      currentCell = "";
    } else if (ch === "\r" && next === "\n") {
      currentRow.push(currentCell.trim() || "");
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      currentRow.push(currentCell.trim() || "");
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim() || "");
    rows.push(currentRow);
  }

  return rows;
}

function extractCandidatesFromSheet(rows: SheetData): {
  candidates: string[];
  rowsScanned: number;
} {
  const nonEmptyRows = rows.filter((row) => !isRowEmpty(row));
  if (nonEmptyRows.length === 0) {
    return { candidates: [], rowsScanned: 0 };
  }

  // Step 1: Scan first 5 non-empty rows for an explicit Email header column
  let headerRowIdx = -1;
  let emailColIdx = -1;
  const headerScanLimit = Math.min(5, nonEmptyRows.length);

  for (let r = 0; r < headerScanLimit; r += 1) {
    const row = nonEmptyRows[r];
    for (let c = 0; c < row.length; c += 1) {
      const text = normalizeCellString(row[c]);
      if (isExplicitEmailHeader(text)) {
        headerRowIdx = r;
        emailColIdx = c;
        break;
      }
    }
    if (emailColIdx !== -1) break;
  }

  if (emailColIdx !== -1) {
    const candidates: string[] = [];
    for (let r = headerRowIdx + 1; r < nonEmptyRows.length; r += 1) {
      const value = normalizeCellString(nonEmptyRows[r][emailColIdx]);
      if (value) candidates.push(value);
    }
    return { candidates, rowsScanned: Math.max(0, nonEmptyRows.length - (headerRowIdx + 1)) };
  }

  // Step 2: Count '@' occurrences per column
  const maxCols = nonEmptyRows.reduce((max, row) => Math.max(max, row.length), 0);
  const atCounts = new Array<number>(maxCols).fill(0);
  const nonEmptyColCounts = new Array<number>(maxCols).fill(0);

  for (const row of nonEmptyRows) {
    for (let c = 0; c < row.length; c += 1) {
      const text = normalizeCellString(row[c]);
      if (text) {
        nonEmptyColCounts[c] += 1;
        if (text.includes("@")) {
          atCounts[c] += 1;
        }
      }
    }
  }

  let bestAtCol = -1;
  let bestAtCount = 0;
  for (let c = 0; c < maxCols; c += 1) {
    if (atCounts[c] > bestAtCount) {
      bestAtCount = atCounts[c];
      bestAtCol = c;
    }
  }

  if (bestAtCol !== -1) {
    const firstVal = normalizeCellString(nonEmptyRows[0][bestAtCol]);
    const startIdx =
      firstVal && !firstVal.includes("@") && GENERIC_NON_EMAIL_HEADER_REGEX.test(firstVal) ? 1 : 0;
    const candidates: string[] = [];
    for (let r = startIdx; r < nonEmptyRows.length; r += 1) {
      const value = normalizeCellString(nonEmptyRows[r][bestAtCol]);
      if (value) candidates.push(value);
    }
    return { candidates, rowsScanned: nonEmptyRows.length - startIdx };
  }

  // Fallback for single-column files with no '@' anywhere
  const activeCols = nonEmptyColCounts.filter((count) => count > 0).length;
  if (activeCols === 1) {
    const soleCol = nonEmptyColCounts.findIndex((count) => count > 0);
    const firstVal = normalizeCellString(nonEmptyRows[0][soleCol]);
    const startIdx = firstVal && GENERIC_NON_EMAIL_HEADER_REGEX.test(firstVal) ? 1 : 0;
    const candidates: string[] = [];
    for (let r = startIdx; r < nonEmptyRows.length; r += 1) {
      const value = normalizeCellString(nonEmptyRows[r][soleCol]);
      if (value) candidates.push(value);
    }
    return { candidates, rowsScanned: nonEmptyRows.length - startIdx };
  }

  return { candidates: [], rowsScanned: nonEmptyRows.length };
}

function mapReadXlsxError(error: unknown): Error {
  if (error instanceof InvalidInputError) {
    if (error.code === "XLS_FILE_NOT_SUPPORTED") {
      return new Error(
        "Định dạng .xls cũ chưa được hỗ trợ. Vui lòng lưu lại tệp dưới dạng .xlsx hoặc .csv."
      );
    }
    if (error.code === "FILE_NOT_SUPPORTED" || error.code === "INVALID_ZIP") {
      return new Error("Tệp Excel không hợp lệ hoặc bị hỏng. Vui lòng chọn tệp .xlsx hoặc .csv.");
    }
    if (error.code === "NO_DATA") {
      return new Error("Tệp Excel không có dữ liệu.");
    }
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("Không thể đọc tệp danh sách học sinh.");
}

async function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Response(file).text();
}

export async function parseRosterImportFile(file: File): Promise<RosterImportParseResult> {
  if (!file) {
    throw new Error("Vui lòng chọn tệp danh sách học sinh.");
  }
  if (file.size === 0) {
    throw new Error("Tệp tải lên đang trống.");
  }
  if (file.size > MAX_ROSTER_IMPORT_FILE_BYTES) {
    throw new Error("Kích thước tệp vượt quá giới hạn 5 MB.");
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xls") && !lowerName.endsWith(".xlsx")) {
    throw new Error(
      "Định dạng .xls cũ chưa được hỗ trợ. Vui lòng lưu lại tệp dưới dạng .xlsx hoặc .csv."
    );
  }

  const isCsv =
    lowerName.endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/csv";

  let sheetDataList: SheetData[];
  const sourceFormat: "xlsx" | "csv" = isCsv ? "csv" : "xlsx";

  if (isCsv) {
    const text = await readFileAsText(file);
    sheetDataList = [parseCsvRows(text)];
  } else {
    try {
      const sheets = await readXlsxFile(file);
      sheetDataList = sheets.map((s) => s.data);
    } catch (error) {
      throw mapReadXlsxError(error);
    }
  }

  const validSet = new Set<string>();
  const invalidSet = new Set<string>();
  let duplicateCount = 0;
  let totalRowsScanned = 0;

  for (const sheetData of sheetDataList) {
    const { candidates, rowsScanned } = extractCandidatesFromSheet(sheetData);
    totalRowsScanned += rowsScanned;

    for (const rawCandidate of candidates) {
      const tokens =
        rawCandidate.includes("@") && /[,;\s]/.test(rawCandidate)
          ? rawCandidate.split(/[,;\s]+/).filter(Boolean)
          : [rawCandidate];

      for (const token of tokens) {
        const normalized = token.trim().toLowerCase();
        if (!normalized) continue;
        if (normalized.length <= 320 && EMAIL_REGEX.test(normalized)) {
          if (validSet.has(normalized)) {
            duplicateCount += 1;
          } else {
            validSet.add(normalized);
          }
        } else {
          invalidSet.add(token.trim());
        }
      }
    }
  }

  const allValid = Array.from(validSet);
  const totalValidFound = allValid.length;
  const emails = allValid.slice(0, MAX_ROSTER_IMPORT_EMAILS);
  const truncatedCount = Math.max(0, totalValidFound - MAX_ROSTER_IMPORT_EMAILS);

  return {
    emails,
    invalidEntries: Array.from(invalidSet),
    duplicateCount,
    totalValidFound,
    truncatedCount,
    totalRowsScanned,
    sourceFormat,
  };
}
