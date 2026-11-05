const MEBIBYTE = 1024 * 1024;

export const MAX_DOCUMENT_IMPORT_BYTES = 25 * MEBIBYTE;
export const MAX_AI_IMPORT_BYTES = 5 * MEBIBYTE;

const DOCUMENT_EXTENSIONS = new Set(["docx", "pdf"]);
const AI_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "txt", "md"]);

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot < 0 ? "" : fileName.slice(lastDot + 1).toLowerCase();
}

export function validateImportFile(
  file: Pick<File, "name" | "size">,
): string | null {
  if (file.size <= 0) {
    return "Tệp đang trống. Vui lòng chọn tệp khác.";
  }

  const extension = getExtension(file.name);
  const isDocument = DOCUMENT_EXTENSIONS.has(extension);
  const isAiImport = AI_EXTENSIONS.has(extension);

  if (!isDocument && !isAiImport) {
    return "Vui lòng tải lên tệp .docx, .pdf, ảnh .png/.jpg/.webp hoặc .txt/.md.";
  }

  const maxBytes = isDocument ? MAX_DOCUMENT_IMPORT_BYTES : MAX_AI_IMPORT_BYTES;
  if (file.size > maxBytes) {
    const maxMegabytes = isDocument ? 25 : 5;
    return `Tệp vượt quá giới hạn ${maxMegabytes} MB. Vui lòng chọn tệp nhỏ hơn.`;
  }

  return null;
}

/**
 * Bước 32 (PLAN_MAIN): kiểm tra chữ ký file (magic bytes) để chặn file
 * giả mạo extension. Chỉ chặn những gì kiểm chứng được bằng vài byte
 * đầu: DOCX phải là zip (PK), PDF phải bắt đầu bằng %PDF, ảnh phải
 * đúng magic của định dạng khai báo. txt/md không kiểm tra (văn bản
 * thuần không có magic). Đây là lớp phòng thủ thêm: trước bước 32,
 * file giả mạo vẫn fail an toàn ở parser (throw → toast lỗi), nhưng
 * thông báo chung chung và parser phải xử lý nội dung lạ trước.
 * Trả về thông báo lỗi hoặc null khi khớp/không kiểm tra được.
 */
export function checkFileSignature(
  extension: string,
  header: Uint8Array,
): string | null {
  const startsWith = (bytes: number[]) =>
    bytes.every((b, i) => header[i] === b);
  switch (extension) {
    case "docx":
      // ZIP: local file header PK\x03\x04, empty archive PK\x05\x06,
      // spanned archive PK\x07\x08.
      if (
        startsWith([0x50, 0x4b, 0x03, 0x04]) ||
        startsWith([0x50, 0x4b, 0x05, 0x06]) ||
        startsWith([0x50, 0x4b, 0x07, 0x08])
      ) {
        return null;
      }
      return "Tệp .docx không đúng định dạng Word (không phải file ZIP). Vui lòng chọn file Word thật.";
    case "pdf":
      if (startsWith([0x25, 0x50, 0x44, 0x46])) return null;
      return "Tệp .pdf không đúng định dạng PDF. Vui lòng chọn file PDF thật.";
    case "png":
      if (startsWith([0x89, 0x50, 0x4e, 0x47])) return null;
      return "Tệp .png không đúng định dạng PNG. Vui lòng chọn ảnh PNG thật.";
    case "jpg":
    case "jpeg":
      if (startsWith([0xff, 0xd8, 0xff])) return null;
      return "Tệp ảnh không đúng định dạng JPEG. Vui lòng chọn ảnh JPEG thật.";
    case "webp":
      if (
        startsWith([0x52, 0x49, 0x46, 0x46]) &&
        header[8] === 0x57 &&
        header[9] === 0x45 &&
        header[10] === 0x42 &&
        header[11] === 0x50
      ) {
        return null;
      }
      return "Tệp .webp không đúng định dạng WebP. Vui lòng chọn ảnh WebP thật.";
    default:
      return null;
  }
}

export async function validateImportFileSignature(
  file: Pick<File, "name" | "slice">,
): Promise<string | null> {
  const extension = getExtension(file.name);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return checkFileSignature(extension, header);
}

export function validatePastedTextSize(text: string): string | null {
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_AI_IMPORT_BYTES) {
    return "Văn bản vượt quá giới hạn 5 MB. Vui lòng rút gọn nội dung.";
  }
  return null;
}
