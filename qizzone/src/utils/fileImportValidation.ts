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

export function validatePastedTextSize(text: string): string | null {
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_AI_IMPORT_BYTES) {
    return "Văn bản vượt quá giới hạn 5 MB. Vui lòng rút gọn nội dung.";
  }
  return null;
}
