/** Public AI behaviour only. The Gemini credential is held by a Supabase Edge Function. */
export const AI_CONFIG = {
  DEFAULT_MODEL: 'gemini-3.6-flash',
  MAX_RETRIES: 3,
  TEMPERATURE: 0.1,
} as const;
