import type { Question } from "@qizzone/domain";
import {
  getOcrQuestionImageBounds,
  attachOcrImageMediaToQuestions,
  attachDocxImagesToQuestions,
  updateQuestionMedia,
  persistQuestionImagesWithUploader,
} from "@qizzone/document-parser";
import { supabase } from "@/lib/cloud";
import { QUESTION_MEDIA_BUCKET } from "@/lib/questionMedia";

export {
  getOcrQuestionImageBounds,
  attachOcrImageMediaToQuestions,
  attachDocxImagesToQuestions,
  updateQuestionMedia,
};

/** Uploads extracted data URLs once and stores storage references in quiz JSON. */
export async function persistQuestionImages(questions: Question[], ownerId?: string): Promise<Question[]> {
  return persistQuestionImagesWithUploader(questions, ownerId, async (blob, path) => {
    const client = supabase();
    const { error } = await client.storage.from(QUESTION_MEDIA_BUCKET).upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(`Không thể lưu hình đề thi: ${error.message}`);
    return `storage://${QUESTION_MEDIA_BUCKET}/${path}`;
  });
}
