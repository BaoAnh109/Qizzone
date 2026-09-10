/** Public AI behaviour only. The Gemini credential is held by a Supabase Edge Function. */
export const AI_CONFIG = {
  DEFAULT_MODEL: 'gemini-3.6-flash',
  FALLBACK_MODEL: 'gemini-2.5-flash',
  TEMPERATURE: 0.1,
} as const;
