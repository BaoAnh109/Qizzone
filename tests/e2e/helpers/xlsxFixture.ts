import JSZip from 'jszip';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnIndexToLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export async function buildRosterXlsxBuffer(
  rows: string[][],
  sheetName = 'Students'
): Promise<Buffer> {
  const safeSheetName = escapeXml(sheetName.slice(0, 31) || 'Students');
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  );

  const rowXml = rows
    .map((cells, rowIdx) => {
      const r = rowIdx + 1;
      const cellXml = cells
        .map((val, colIdx) => {
          const ref = `${columnIndexToLetters(colIdx)}${r}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(val ?? ''))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}">${cellXml}</row>`;
    })
    .join('');

  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function buildRosterXlsxInputFile(
  rows: string[][],
  fileName = 'roster.xlsx',
  sheetName = 'Students'
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const buffer = await buildRosterXlsxBuffer(rows, sheetName);
  return {
    name: fileName,
    mimeType: XLSX_MIME,
    buffer,
  };
}

export function buildRosterCsvInputFile(
  csvContent: string,
  fileName = 'roster.csv'
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: fileName,
    mimeType: 'text/csv',
    buffer: Buffer.from(csvContent, 'utf8'),
  };
}

export function buildLegacyXlsInputFile(
  fileName = 'legacy.xls'
): { name: string; mimeType: string; buffer: Buffer } {
  // BIFF8 header magic bytes for legacy .xls binary file
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return {
    name: fileName,
    mimeType: 'application/vnd.ms-excel',
    buffer: header,
  };
}

export function buildMalformedXlsxInputFile(
  fileName = 'broken.xlsx'
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: fileName,
    mimeType: XLSX_MIME,
    buffer: Buffer.from('CORRUPT_NOT_A_VALID_ZIP_XLSX_PAYLOAD', 'utf8'),
  };
}

export function buildEmptyXlsxInputFile(
  fileName = 'empty.xlsx'
): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name: fileName,
    mimeType: XLSX_MIME,
    buffer: Buffer.alloc(0),
  };
}
