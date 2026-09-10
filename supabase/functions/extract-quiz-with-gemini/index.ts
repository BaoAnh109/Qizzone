import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-2.5-flash';
const GEMINI_ATTEMPT_TIMEOUT_MS = 26_000;

type GeminiResult = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
};

function modelCandidates() {
  return [...new Set([
    Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL,
    Deno.env.get('GEMINI_FALLBACK_MODEL') || DEFAULT_FALLBACK_MODEL,
  ].map(value => value.trim()).filter(Boolean))];
}

function transientGeminiStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function upstreamError(status: number) {
  if (status === 429) return new Error('RATE_LIMIT');
  if ([401, 403].includes(status)) return new Error('GEMINI_AUTH');
  if (status === 404) return new Error('GEMINI_MODEL_UNAVAILABLE');
  if (status === 400) return new Error('GEMINI_BAD_REQUEST');
  if (status === 408 || status === 504) return new Error('GEMINI_TIMEOUT');
  if (status >= 500) return new Error('GEMINI_UNAVAILABLE');
  return new Error('UPSTREAM_ERROR');
}

function parseGeminiJson(result: GeminiResult) {
  const candidate = result.candidates?.[0];
  const raw = candidate?.content?.parts?.map(part => part.text || '').join('').trim();
  if (!raw) throw new Error(candidate?.finishReason ? 'GEMINI_EMPTY_RESPONSE' : 'UPSTREAM_ERROR');
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error('GEMINI_INVALID_RESPONSE');
  }
}

async function callGemini(key: string, parts: unknown[], requestId: string) {
  const candidates = modelCandidates();
  let lastError: Error = new Error('GEMINI_UNAVAILABLE');

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const selectedModel = candidates[attempt];
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }),
        signal: AbortSignal.timeout(GEMINI_ATTEMPT_TIMEOUT_MS),
      });

      if (response.ok) {
        return { model: selectedModel, result: parseGeminiJson(await response.json()) };
      }

      lastError = upstreamError(response.status);
      console.warn(JSON.stringify({ requestId, model: selectedModel, attempt: attempt + 1, upstreamStatus: response.status }));
      if (!transientGeminiStatus(response.status) && response.status !== 404) throw lastError;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GEMINI_')) lastError = error;
      else if (error instanceof DOMException && error.name === 'TimeoutError') lastError = new Error('GEMINI_TIMEOUT');
      else lastError = new Error('UPSTREAM_ERROR');

      console.warn(JSON.stringify({ requestId, model: selectedModel, attempt: attempt + 1, code: lastError.message }));
      if (['GEMINI_AUTH', 'GEMINI_BAD_REQUEST'].includes(lastError.message)) throw lastError;
    }

    if (attempt < candidates.length - 1) {
      const delayMs = 500 * (2 ** attempt) + Math.floor(Math.random() * 250);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let uid = 'unknown';
  let model = 'unknown';
  try {
    const token = await identity(req);
    uid = token.uid;
    const user = await firebaseAdmin().getUser(token.uid);
    if (!['teacher','admin'].includes(user.customClaims?.app_role) || token.app_role !== user.customClaims?.app_role) throw new Error('FORBIDDEN');
    const body = await bodyJson(req, 8 * 1024 * 1024);
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 250000 || body.apiKey) throw new Error('INVALID_INPUT');
    const parts: unknown[] = [{ text: body.prompt }];
    if (body.imageBase64) {
      if (typeof body.imageBase64 !== 'string') throw new Error('INVALID_INPUT');
      const image = body.imageBase64.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!image) throw new Error('INVALID_INPUT');
      const binary = atob(image[2]);
      const valid = image[1] === 'image/png' ? binary.startsWith('\x89PNG\r\n\x1a\n') : image[1] === 'image/jpeg' ? binary.startsWith('\xff\xd8\xff') : binary.startsWith('RIFF') && binary.slice(8,12) === 'WEBP';
      if (!valid) throw new Error('INVALID_INPUT');
      parts.push({ inlineData: { mimeType: image[1], data: image[2] } });
    }
    const { data: allowed, error } = await databaseAdmin().rpc('consume_ai_quota', { p_uid: user.uid });
    if (error) throw error;
    if (!allowed) throw new Error('RATE_LIMIT');
    // `Gemini` was the original production secret name. Keep it as a
    // compatibility fallback so existing deployments continue to work while
    // new environments use the conventional GEMINI_API_KEY name.
    const key = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('Gemini');
    if (!key) throw new Error('NOT_CONFIGURED');
    const generated = await callGemini(key, parts, requestId);
    model = generated.model;
    console.info(JSON.stringify({ requestId, uid, model, durationMs: Math.round(performance.now() - startedAt), status: 'ok' }));
    return respond(req, { result: generated.result });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : 'UNKNOWN';
    const code = ['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_INPUT', 'TOO_LARGE', 'RATE_LIMIT', 'NOT_CONFIGURED', 'GEMINI_AUTH', 'GEMINI_MODEL_UNAVAILABLE', 'GEMINI_BAD_REQUEST', 'GEMINI_TIMEOUT', 'GEMINI_UNAVAILABLE', 'GEMINI_EMPTY_RESPONSE', 'GEMINI_INVALID_RESPONSE', 'UPSTREAM_ERROR']
      .includes(rawCode) ? rawCode : 'INTERNAL_ERROR';
    console.error(JSON.stringify({
      requestId, uid, model, durationMs: Math.round(performance.now() - startedAt),
      status: 'error', code,
    }));
    return failure(req, error);
  }
});
