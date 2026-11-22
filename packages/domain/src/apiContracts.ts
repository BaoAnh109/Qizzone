import { z } from "zod";

export const MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB via R2 presigned PUT

export const ALLOWED_MATERIAL_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
] as const;

export const createUploadUrlRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_MATERIAL_MIME_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_DIRECT_UPLOAD_BYTES),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "SHA-256 phải gồm 64 ký tự hex")
    .optional(),
});

export type CreateUploadUrlRequest = z.infer<typeof createUploadUrlRequestSchema>;

export const createUploadUrlResponseSchema = z.object({
  materialId: z.string().uuid(),
  objectKey: z.string().min(1),
  putUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export type CreateUploadUrlResponse = z.infer<typeof createUploadUrlResponseSchema>;

export const confirmUploadRequestSchema = z.object({
  materialId: z.string().uuid(),
});

export type ConfirmUploadRequest = z.infer<typeof confirmUploadRequestSchema>;

export const confirmUploadResponseSchema = z.object({
  status: z.enum(["ready", "failed"]),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
});

export type ConfirmUploadResponse = z.infer<typeof confirmUploadResponseSchema>;

export const extractionModeSchema = z.enum([
  "structural_fallback",
  "scan_ocr_vlm",
  "solve_missing_answers",
]);

export type ExtractionMode = z.infer<typeof extractionModeSchema>;

export const extractQuizRequestSchema = z
  .object({
    materialId: z.string().uuid().optional(),
    extractedText: z.string().max(150_000).optional(),
    selectedPages: z.array(z.number().int().positive()).max(50).optional(),
    extractionMode: extractionModeSchema.default("structural_fallback"),
    prompt: z.string().max(150_000).optional(),
    imageBase64: z.string().max(7_000_000).optional(),
  })
  .refine(
    (data) => Boolean(data.materialId || data.extractedText?.trim() || data.prompt?.trim() || data.imageBase64),
    { message: "Cần cung cấp materialId, văn bản trích xuất hoặc ảnh." }
  );

export type ExtractQuizRequest = z.infer<typeof extractQuizRequestSchema>;

export const aiJobStatusValueSchema = z.enum(["queued", "processing", "completed", "failed"]);
export type AiJobStatusValue = z.infer<typeof aiJobStatusValueSchema>;

export const extractQuizResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: aiJobStatusValueSchema,
  result: z.unknown().optional(),
});

export type ExtractQuizResponse = z.infer<typeof extractQuizResponseSchema>;

export const aiJobStatusResponseSchema = z.object({
  id: z.string().uuid(),
  status: aiJobStatusValueSchema,
  progress: z.number().min(0).max(100),
  warnings: z.array(z.string()),
  resultDraftId: z.string().uuid().nullable().optional(),
  resultDraft: z.unknown().optional(),
  errorCode: z.string().nullable().optional(),
});

export type AiJobStatusResponse = z.infer<typeof aiJobStatusResponseSchema>;

export const finalizeExamRequestSchema = z.object({
  attemptId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export type FinalizeExamRequest = z.infer<typeof finalizeExamRequestSchema>;

export const finalizeExamResponseSchema = z.object({
  score: z.number().min(0).max(10).nullable(),
  status: z.enum(["submitted", "already_submitted"]),
  result: z.unknown(),
});

export type FinalizeExamResponse = z.infer<typeof finalizeExamResponseSchema>;

export const dispatchEmailRequestSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  dryRun: z.boolean().optional().default(false),
});

export type DispatchEmailRequest = z.infer<typeof dispatchEmailRequestSchema>;

export const manageUserAccountsRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    role: z.enum(["teacher", "student", "admin", "all"]).optional(),
    includeAdmins: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("detail"),
    userId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("toggle_block"),
    userId: z.string().trim().min(1),
    isBlocked: z.boolean(),
    role: z.enum(["student", "teacher", "admin"]).optional(),
  }),
  z.object({
    action: z.literal("change_role"),
    userId: z.string().trim().min(1),
    nextRole: z.enum(["student", "teacher", "admin"]),
  }),
  z.object({
    action: z.literal("review_teacher"),
    userId: z.string().trim().min(1),
    decision: z.enum(["approve", "reject"]),
  }),
]);

export type ManageUserAccountsRequest = z.infer<typeof manageUserAccountsRequestSchema>;
