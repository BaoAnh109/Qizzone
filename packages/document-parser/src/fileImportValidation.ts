const MEBIBYTE = 1024 * 1024;

export const MAX_DOCUMENT_IMPORT_BYTES = 25 * MEBIBYTE;
export const MAX_AI_IMPORT_BYTES = 5 * MEBIBYTE;
export const MAX_R2_MATERIAL_BYTES = 50 * MEBIBYTE;

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

export async function validateImportFileSignature(
  file: Pick<File, "name" | "slice">,
): Promise<string | null> {
  const extension = getExtension(file.name);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);

  if (extension === "pdf" && !(startsWith(0x25, 0x50, 0x44, 0x46, 0x2d))) {
    return "Tệp không phải PDF hợp lệ hoặc phần mở rộng không khớp nội dung.";
  }
  if (extension === "docx" && !startsWith(0x50, 0x4b, 0x03, 0x04) && !startsWith(0x50, 0x4b, 0x05, 0x06)) {
    return "Tệp Word không có cấu trúc DOCX hợp lệ hoặc phần mở rộng không khớp nội dung.";
  }
  if (["png"].includes(extension) && !startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "Tệp không phải ảnh PNG hợp lệ.";
  }
  if (["jpg", "jpeg"].includes(extension) && !startsWith(0xff, 0xd8, 0xff)) {
    return "Tệp không phải ảnh JPEG hợp lệ.";
  }
  if (extension === "webp") {
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!isWebp) return "Tệp không phải ảnh WebP hợp lệ.";
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

export function validateR2MaterialUpload(
  file: Pick<File, "name" | "size">,
): string | null {
  if (file.size <= 0) {
    return "Tệp đang trống. Vui lòng chọn tệp khác.";
  }
  const extension = getExtension(file.name);
  if (!DOCUMENT_EXTENSIONS.has(extension) && !AI_EXTENSIONS.has(extension)) {
    return "Vui lòng tải lên tệp .docx, .pdf, ảnh .png/.jpg/.webp hoặc .txt/.md.";
  }
  if (file.size > MAX_R2_MATERIAL_BYTES) {
    return "Tệp vượt quá giới hạn tải lên trực tiếp 50 MB.";
  }
  return null;
}
