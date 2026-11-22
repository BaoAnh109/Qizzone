import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  MAX_ROSTER_IMPORT_EMAILS,
  parseRosterImportFile,
} from "@/utils/excelRosterImport";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetters(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

async function createMinimalXlsxFile(
  rows: Array<Array<string | number>>,
  fileName = "roster.xlsx",
): Promise<File> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="DanhSach" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
  );

  const rowXml = rows
    .map((row, rIdx) => {
      const cellsXml = row
        .map((cell, cIdx) => {
          const ref = `${colLetters(cIdx)}${rIdx + 1}`;
          if (typeof cell === "number") {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rIdx + 1}">${cellsXml}</row>`;
    })
    .join("");

  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("excelRosterImport", () => {
  it("parses a real .xlsx file with multi-column headers, normalizes, deduplicates, and separates invalid entries", async () => {
    const xlsxFile = await createMinimalXlsxFile([
      ["STT", "Họ và tên", "Email học sinh"],
      [1, "Nguyễn Văn A", " Student.A@School.edu.vn "],
      [2, "Trần Thị B", "student.b@school.edu.vn"],
      [3, "Nguyễn Văn A (trùng)", "student.a@school.edu.vn"],
      [4, "Lê Văn C", "not-an-email"],
    ]);

    const result = await parseRosterImportFile(xlsxFile);

    expect(result.sourceFormat).toBe("xlsx");
    expect(result.emails).toEqual([
      "student.a@school.edu.vn",
      "student.b@school.edu.vn",
    ]);
    expect(result.invalidEntries).toEqual(["not-an-email"]);
    expect(result.duplicateCount).toBe(1);
    expect(result.totalValidFound).toBe(2);
    expect(result.truncatedCount).toBe(0);
    expect(result.totalRowsScanned).toBe(4);
  });

  it("parses .csv with UTF-8 BOM, semicolon delimiter, and quoted fields", async () => {
    const csvContent =
      "\uFEFF" +
      [
        'STT;"Họ và tên";Email',
        '1;"Nguyễn, Văn An";HS1@Example.Test',
        '2;"Trần ""Bình""";hs2@example.test',
        '3;"Lê Chi";hs1@example.test',
        '4;"Sai định dạng";invalid-email',
      ].join("\r\n");

    const file = new File([csvContent], "lop12a1.csv", { type: "text/csv" });
    const result = await parseRosterImportFile(file);

    expect(result.sourceFormat).toBe("csv");
    expect(result.emails).toEqual(["hs1@example.test", "hs2@example.test"]);
    expect(result.invalidEntries).toEqual(["invalid-email"]);
    expect(result.duplicateCount).toBe(1);
  });

  it("detects email column automatically when no explicit email header exists", async () => {
    const csvContent = [
      "1,Nguyễn Văn A,auto1@example.test",
      "2,Trần Thị B,auto2@example.test",
    ].join("\n");

    const file = new File([csvContent], "no-header.csv", { type: "text/csv" });
    const result = await parseRosterImportFile(file);

    expect(result.emails).toEqual(["auto1@example.test", "auto2@example.test"]);
    expect(result.invalidEntries).toEqual([]);
  });

  it("rejects legacy .xls files with a friendly Vietnamese error message", async () => {
    const legacyFile = new File(["dummy xls"], "danhsach.xls", {
      type: "application/vnd.ms-excel",
    });

    await expect(parseRosterImportFile(legacyFile)).rejects.toThrow(/\.xls/i);
  });

  it("caps extracted unique valid emails at MAX_ROSTER_IMPORT_EMAILS (500) and reports truncatedCount", async () => {
    const lines = ["Email"];
    for (let i = 1; i <= 515; i += 1) {
      lines.push(`student${i}@school.edu.vn`);
    }
    const file = new File([lines.join("\n")], "large.csv", { type: "text/csv" });

    const result = await parseRosterImportFile(file);

    expect(MAX_ROSTER_IMPORT_EMAILS).toBe(500);
    expect(result.emails).toHaveLength(500);
    expect(result.totalValidFound).toBe(515);
    expect(result.truncatedCount).toBe(15);
    expect(result.emails[0]).toBe("student1@school.edu.vn");
    expect(result.emails[499]).toBe("student500@school.edu.vn");
  });
});
