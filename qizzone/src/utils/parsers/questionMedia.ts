import type { ExtractedQuestion, ExtractionResult } from "@/types/extractor";
import type { DocumentIR, DocumentIRBlock } from "@/types/documentIR";
import type { OptionId, Question } from "@/types/quiz";
import { supabase } from "@/lib/cloud";
import { QUESTION_MEDIA_BUCKET } from "@/lib/questionMedia";

const OPTION_IDS: OptionId[] = ["A", "B", "C", "D"];
const MAX_IMAGE_DATA_LENGTH = 900_000;

type ImageBounds = [number, number, number, number];

function getBounds(blocks: DocumentIRBlock[]): ImageBounds | undefined {
  const boxes = blocks.flatMap(block => block.bbox ? [block.bbox as ImageBounds] : []);
  if (!boxes.length) return undefined;
  return [
    Math.min(...boxes.map(box => box[0])),
    Math.min(...boxes.map(box => box[1])),
    Math.max(...boxes.map(box => box[2])),
    Math.max(...boxes.map(box => box[3])),
  ];
}

/** Returns a crop for the prompt and nearby figure, stopping before answer text. */
export function getOcrQuestionImageBounds(
  question: ExtractedQuestion,
  documentIR: DocumentIR,
  width: number,
  height: number,
): ImageBounds | undefined {
  const blocks = new Map(documentIR.pages.flatMap(page => page.blocks).map(block => [block.id, block]));
  const promptBlocks = (question.promptSourceRefs || []).flatMap(id => {
    const block = blocks.get(id);
    return block?.bbox ? [block] : [];
  });
  const prompt = getBounds(promptBlocks);
  if (!prompt) return undefined;

  const answerBounds = question.options.flatMap(option => (option.sourceRefs || []).flatMap(id => {
    const block = blocks.get(id);
    return block?.bbox ? [block.bbox as ImageBounds] : [];
  }));
  const xPadding = Math.max(16, width * 0.06);
  const yPadding = Math.min(100, Math.max(24, height * 0.08));
  let top = Math.max(0, prompt[1] - yPadding);
  let bottom = Math.min(height, prompt[3] + yPadding);

  const firstOptionTop = Math.min(...answerBounds
    .filter(bounds => bounds[1] >= prompt[3] - 12)
    .map(bounds => bounds[1]), Infinity);
  if (Number.isFinite(firstOptionTop) && firstOptionTop - prompt[3] <= 240) {
    bottom = Math.min(bottom, Math.max(prompt[3] + 7, firstOptionTop - 7));
  }

  const currentCenterY = (prompt[1] + prompt[3]) / 2;
  const previousQuestionBottoms = documentIR.pages.flatMap(page => page.blocks)
    .filter(block => block.type === "text_span" || block.type === "paragraph")
    .flatMap(block => {
      if (!block.bbox || (question.promptSourceRefs || []).includes(block.id)) return [];
      const bounds = block.bbox as ImageBounds;
      const centerY = (bounds[1] + bounds[3]) / 2;
      const horizontalGap = Math.max(0, prompt[0] - bounds[2], bounds[0] - prompt[2]);
      return centerY < currentCenterY && bounds[3] <= prompt[1] && horizontalGap < 48 ? [bounds[3]] : [];
    });
  if (previousQuestionBottoms.length) {
    top = Math.max(top, Math.max(...previousQuestionBottoms) + 7);
  }

  return [
    Math.max(0, prompt[0] - xPadding),
    top,
    Math.min(width, prompt[2] + xPadding),
    bottom,
  ];
}

/** Crops diagrams from an OCR-scanned image into the question prompt before review. */
export async function attachOcrImageMediaToQuestions(
  result: ExtractionResult,
  imageDataUrl: string,
  documentIR: DocumentIR,
): Promise<ExtractionResult> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return result;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(await (await fetch(imageDataUrl)).blob());
  } catch {
    return result;
  }
  const canvas = document.createElement("canvas");
  let bytesUsed = 0;
  let imageCount = 0;
  const images = new Map<string, string>();
  for (const question of result.questions) {
    if (imageCount >= 80 || bytesUsed >= 15_000_000) break;
    const bounds = getOcrQuestionImageBounds(question, documentIR, bitmap.width, bitmap.height);
    if (!bounds) continue;
    const [left, top, right, bottom] = bounds.map(Math.round) as ImageBounds;
    const cropWidth = right - left;
    const cropHeight = bottom - top;
    if (cropWidth < 24 || cropHeight < 24) continue;
    const scale = Math.min(1, 1400 / Math.max(cropWidth, cropHeight));
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    let image = canvas.toDataURL("image/jpeg", 0.82);
    if (image.length > MAX_IMAGE_DATA_LENGTH) image = canvas.toDataURL("image/jpeg", 0.65);
    if (image.length > MAX_IMAGE_DATA_LENGTH) continue;
    images.set(question.id, image);
    imageCount += 1;
    bytesUsed += image.length;
  }
  bitmap.close();
  return {
    ...result,
    questions: result.questions.map(question => {
      const image = images.get(question.id);
      return image ? { ...question, images: [...(question.images || []), image] } : question;
    }),
  };
}
async function convertImageToJpeg(value: string): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("Trình duyệt hiện tại không hỗ trợ lưu hình đề thi.");
  }
  const bitmap = await createImageBitmap(await (await fetch(value)).blob());
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Không thể chuẩn bị hình đề thi để lưu.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.78));
  if (!blob || blob.size > 900_000) throw new Error("Một hình trong đề vượt quá giới hạn 900 KB sau khi nén.");
  return blob;
}

/** Uploads extracted data URLs once and stores lightweight public-storage references in quiz JSON. */
export async function persistQuestionImages(questions: Question[], ownerId?: string): Promise<Question[]> {
  const dataImages = [...new Set(questions.flatMap(question => [
    ...(question.images || []),
    ...question.options.flatMap(option => option.images || []),
  ]).filter(image => image.startsWith("data:image/")))];
  if (!dataImages.length) return questions;
  if (!ownerId) throw new Error("Không xác định được tài khoản giáo viên để lưu hình đề thi.");
  if (dataImages.length > 80) throw new Error("Đề vượt quá giới hạn 80 hình; hãy giảm số hình rồi thử lại.");

  const client = supabase();
  const stored = new Map<string, string>();
  let totalBytes = 0;
  for (let index = 0; index < dataImages.length; index += 4) {
    const batch = dataImages.slice(index, index + 4);
    const uploads = await Promise.all(batch.map(async image => {
      if (!/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(image)) {
        throw new Error("Hình đề thi không đúng định dạng ảnh được hỗ trợ.");
      }
      const blob = await convertImageToJpeg(image);
      totalBytes += blob.size;
      if (totalBytes > 15_000_000) throw new Error("Tổng dung lượng hình trong đề vượt quá 15 MB.");
      const path = `${ownerId}/${crypto.randomUUID()}.jpg`;
      const { error } = await client.storage.from(QUESTION_MEDIA_BUCKET).upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw new Error(`Không thể lưu hình đề thi: ${error.message}`);
      return [image, `storage://${QUESTION_MEDIA_BUCKET}/${path}`] as const;
    }));
    uploads.forEach(([source, path]) => stored.set(source, path));
  }

  const persist = (images?: string[]) => images?.map(image => stored.get(image) || image);
  return questions.map(question => ({
    ...question,
    ...(question.images?.length ? { images: persist(question.images) } : {}),
    options: question.options.map(option => ({
      ...option,
      ...(option.images?.length ? { images: persist(option.images) } : {}),
    })),
  }));
}

async function prepareEmbeddedImage(value: string): Promise<string | undefined> {
  if (!/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(value)) return undefined;
  if (value.length <= MAX_IMAGE_DATA_LENGTH) return value;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;
  try {
    const bitmap = await createImageBitmap(await (await fetch(value)).blob());
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return undefined;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const compressed = canvas.toDataURL("image/jpeg", 0.78);
    return compressed.length <= MAX_IMAGE_DATA_LENGTH ? compressed : undefined;
  } catch {
    return undefined;
  }
}

function htmlToPlainText(value: string): string {
  return value
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function optionAtImagePosition(rawSegment: string, imageIndex: number): OptionId | undefined {
  const plainBeforeImage = htmlToPlainText(rawSegment.slice(0, imageIndex));
  const lineMarkers = [...plainBeforeImage.matchAll(/(?:^|\n)\s*([A-D])\s*[.)\-:]\s*/gi)];
  const inlineMarkers = lineMarkers.length
    ? lineMarkers
    : [...plainBeforeImage.matchAll(/(?:^|\s)([A-D])\s*[.)\-:]\s+(?=\S)/gi)];
  const marker = inlineMarkers.at(-1)?.[1]?.toUpperCase() as OptionId | undefined;
  return marker && OPTION_IDS.includes(marker) ? marker : undefined;
}

/** Maps DOCX image runs back to the prompt or option that contains the image run. */
export async function attachDocxImagesToQuestions(
  result: ExtractionResult,
  extractedImages: Record<string, string>,
): Promise<ExtractionResult> {
  const preparedImages = new Map<string, string | undefined>();
  const allImageIds = result.questions.flatMap(question => [...question.rawTextSegment.matchAll(/data-image-id\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]));
  for (const imageId of [...new Set(allImageIds)].slice(0, 80)) {
    const original = extractedImages[imageId];
    if (!original) continue;
    const totalSize = [...preparedImages.values()].reduce((sum, image) => sum + (image?.length || 0), 0);
    if (totalSize >= 15_000_000) break;
    preparedImages.set(imageId, await prepareEmbeddedImage(original));
  }

  const questions = result.questions.map(question => {
    const promptImages = [...(question.images || [])];
    const optionImages = new Map<OptionId, string[]>(question.options.map(option => [option.id, [...(option.images || [])]]));
    const marker = /data-image-id\s*=\s*["']([^"']+)["']/gi;
    let imageMatch: RegExpExecArray | null;
    while ((imageMatch = marker.exec(question.rawTextSegment)) !== null) {
      const image = preparedImages.get(imageMatch[1]);
      if (!image) continue;
      const optionId = optionAtImagePosition(question.rawTextSegment, imageMatch.index);
      if (optionId && question.options.some(option => option.id === optionId)) {
        const images = optionImages.get(optionId) || [];
        if (!images.includes(image)) images.push(image);
        optionImages.set(optionId, images);
      } else if (!promptImages.includes(image)) {
        promptImages.push(image);
      }
    }
    return {
      ...question,
      content: question.content.replace(/\[Hình ảnh\]/gi, "").trim(),
      images: promptImages.length ? promptImages : undefined,
      options: question.options.map(option => ({
        ...option,
        content: option.content.replace(/\[Hình ảnh\]/gi, "").trim(),
        images: optionImages.get(option.id)?.length ? optionImages.get(option.id) : undefined,
      })),
    };
  });
  return { ...result, questions };
}

export function updateQuestionMedia(
  question: ExtractedQuestion,
  media: { promptImages?: string[]; optionImages?: Partial<Record<OptionId, string[]>> },
): ExtractedQuestion {
  return {
    ...question,
    images: media.promptImages?.length ? [...new Set([...(question.images || []), ...media.promptImages])] : question.images,
    options: question.options.map(option => ({
      ...option,
      images: media.optionImages?.[option.id]?.length
        ? [...new Set([...(option.images || []), ...media.optionImages![option.id]!])]
        : option.images,
    })),
  };
}
