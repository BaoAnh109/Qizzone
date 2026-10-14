/** Public AI behaviour only. The Gemini credential is held by a Supabase Edge Function. */
export const AI_CONFIG = {
  DEFAULT_MODEL: 'gemini-3.6-flash',
  FALLBACK_MODELS: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const,
  BATCH_SIZE: 12,
  MAX_RETRIES: 3,
  TEMPERATURE: 0.1,
} as const;
