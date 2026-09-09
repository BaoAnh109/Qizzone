import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

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
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) throw new Error('NOT_CONFIGURED');
    model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } }),
      signal: AbortSignal.timeout(55000),
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_ERROR');
    const result = await response.json();
    const raw = result.candidates?.[0]?.content?.parts?.map((p: {text?: string}) => p.text || '').join('');
    if (!raw) throw new Error('UPSTREAM_ERROR');
    console.info(JSON.stringify({ requestId, uid, model, durationMs: Math.round(performance.now() - startedAt), status: 'ok' }));
    return respond(req, { result: JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) });
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : 'UNKNOWN';
    const code = ['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_INPUT', 'TOO_LARGE', 'RATE_LIMIT', 'NOT_CONFIGURED', 'UPSTREAM_ERROR']
      .includes(rawCode) ? rawCode : 'INTERNAL_ERROR';
    console.error(JSON.stringify({
      requestId, uid, model, durationMs: Math.round(performance.now() - startedAt),
      status: 'error', code,
    }));
    return failure(req, error);
  }
});
