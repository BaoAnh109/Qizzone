import { supabase } from "@/lib/cloud";

export const QUESTION_MEDIA_BUCKET = "qizzone-question-media";
const publicUrlCache = new Map<string, string>();

export function resolveQuestionImageUrl(image: string): string | undefined {
  const prefix = `storage://${QUESTION_MEDIA_BUCKET}/`;
  if (!image.startsWith(prefix)) {
    return /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i.test(image) ? image : undefined;
  }
  const cached = publicUrlCache.get(image);
  if (cached) return cached;
  const path = image.slice(prefix.length);
  if (!path || path.split("/").length !== 2 || path.includes("..")) return undefined;
  const url = supabase().storage.from(QUESTION_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  publicUrlCache.set(image, url);
  return url;
}
