import { fetchR2ObjectResponse } from './r2.ts';
import {
  bodyJson,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
  structuredLog,
  type VerifiedIdentity,
} from './server.ts';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ATTEMPT_TIMEOUT_MS = 40_000;
const MAX_IMAGE_BASE64_CHARS = 7_000_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GeminiResult = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
};

function modelCandidates(): string[] {
  const configured = Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_MODEL;
  const fallback = Deno.env.get('GEMINI_FALLBACK_MODEL')?.trim() || FALLBACK_MODEL;
  return [
    ...new Set(
      [configured, fallback].filter(
        (value): value is string => Boolean(value) && /^gemini-[a-z0-9.-]+$/i.test(value),
      ),
    ),
  ].slice(0, 2);
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

/** Uploads a private R2 object stream to Gemini Files API so large files never become Base64 in Edge RAM. */
async function uploadR2ObjectToGeminiFilesApi(
  key: string,
  objectKey: string,
  mimeType: string,
  displayName: string,
): Promise<{ uri: string; name: string }> {
  const r2Response = await fetchR2ObjectResponse(objectKey);
  const contentLength = r2Response.headers.get('content-length');
  if (!r2Response.body || !contentLength) {
    throw new Error('R2_UPLOAD_NOT_FOUND');
  }

  const startRes = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': contentLength,
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!startRes.ok) throw upstreamError(startRes.status);
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('UPSTREAM_ERROR');

  const finalizeRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType,
    },
    body: r2Response.body,
    signal: AbortSignal.timeout(45_000),
  });
  if (!finalizeRes.ok) throw upstreamError(finalizeRes.status);
  const meta = (await finalizeRes.json()) as { file?: { uri?: string; name?: string } };
  if (!meta.file?.uri || !meta.file?.name) throw new Error('UPSTREAM_ERROR');
  return { uri: meta.file.uri, name: meta.file.name };
}

async function deleteGeminiFileQuietly(key: string, fileName: string) {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Gemini automatically expires uploaded files after 48 hours.
  }
}

async function callGemini(key: string, parts: unknown[], requestId: string) {
  const candidates = modelCandidates();
  if (!candidates.length) throw new Error('NOT_CONFIGURED');
  let lastError: Error = new Error('GEMINI_UNAVAILABLE');

  for (const selectedModel of candidates) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
              maxOutputTokens: 8192,
            },
          }),
          signal: AbortSignal.timeout(GEMINI_ATTEMPT_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        return { model: selectedModel, result: parseGeminiJson(await response.json()) };
      }
      lastError = upstreamError(response.status);
      structuredLog('warn', { requestId, model: selectedModel, upstreamStatus: response.status });
      if ([400, 401, 403].includes(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GEMINI_')) lastError = error;
      else if (error instanceof DOMException && error.name === 'TimeoutError') lastError = new Error('GEMINI_TIMEOUT');
      else lastError = new Error('UPSTREAM_ERROR');
      structuredLog('warn', { requestId, model: selectedModel, code: lastError.message });
      if (['GEMINI_AUTH', 'GEMINI_BAD_REQUEST'].includes(lastError.message)) throw lastError;
    }
  }
  throw lastError;
}

export async function handleExtractQuizRequest(
  req: Request,
  authArg?: VerifiedIdentity,
) {
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const startedAt = performance.now();
  let model = DEFAULT_MODEL;
  let jobId: string | null = null;
  let geminiUploadedName: string | null = null;
  let geminiKey: string | undefined;

  const db = databaseAdmin();
  try {
    const auth = authArg || (await identity(req));
    await requireProfileAndRole(db, auth, ['teacher', 'admin']);

    const body = (await bodyJson(req, 8 * 1024 * 1024)) as {
      prompt?: unknown;
      extractedText?: unknown;
      imageBase64?: unknown;
      materialId?: unknown;
      selectedPages?: unknown;
      extractionMode?: unknown;
      apiKey?: unknown;
    };

    if (body.apiKey) throw new Error('INVALID_INPUT');

    const promptText =
      typeof body.prompt === 'string' && body.prompt.trim()
        ? body.prompt
        : typeof body.extractedText === 'string' && body.extractedText.trim()
          ? body.extractedText
          : '';
    const hasMaterial = typeof body.materialId === 'string' && UUID_REGEX.test(body.materialId);
    const hasImage = typeof body.imageBase64 === 'string' && body.imageBase64.length > 0;

    if ((!promptText && !hasMaterial && !hasImage) || promptText.length > 150_000) {
      throw new Error('INVALID_INPUT');
    }

    const mode =
      body.extractionMode === 'scan_ocr_vlm' || body.extractionMode === 'solve_missing_answers'
        ? body.extractionMode
        : 'structural_fallback';

    const selectedPages = Array.isArray(body.selectedPages)
      ? body.selectedPages.filter((p): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0).slice(0, 50)
      : null;

    const { data: allowed, error: quotaError } = await db.rpc('consume_ai_quota_v3', {
      p_uid: auth.uid,
      p_daily_limit: Number(Deno.env.get('AI_DAILY_USER_LIMIT') || 100),
    });
    if (quotaError) throw quotaError;
    if (!allowed) throw new Error('RATE_LIMIT');

    geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('Gemini');
    if (!geminiKey) throw new Error('NOT_CONFIGURED');

    const { data: createdJob, error: jobCreateError } = await db
      .from('ai_extraction_jobs')
      .insert({
        owner_uid: auth.uid,
        material_id: hasMaterial ? body.materialId : null,
        extraction_mode: mode,
        selected_pages: selectedPages,
        status: 'processing',
        progress: 10,
      })
      .select('id')
      .single();
    if (jobCreateError) throw jobCreateError;
    jobId = createdJob.id;

    const parts: unknown[] = [];
    if (promptText) {
      parts.push({ text: promptText });
    } else if (hasMaterial) {
      const pageHint = selectedPages?.length ? ` Chỉ xử lý các trang: ${selectedPages.join(', ')}.` : '';
      parts.push({
        text: `Trích xuất cấu trúc câu hỏi nguyên văn từ tài liệu đính kèm.${pageHint} Không tự suy luận đáp án.`,
      });
    }

    if (hasMaterial) {
      const { data: material, error: matErr } = await db
        .from('materials')
        .select('*')
        .eq('id', body.materialId)
        .maybeSingle();
      if (matErr) throw matErr;
      if (!material || (material.owner_uid !== auth.uid && auth.app_role !== 'admin')) {
        throw new Error('FORBIDDEN');
      }
      if (material.status !== 'ready') throw new Error('R2_UPLOAD_NOT_FOUND');

      const uploaded = await uploadR2ObjectToGeminiFilesApi(
        geminiKey,
        material.object_key,
        material.mime_type,
        material.file_name,
      );
      geminiUploadedName = uploaded.name;
      parts.push({ file_data: { mime_type: material.mime_type, file_uri: uploaded.uri } });
      await db
        .from('ai_extraction_jobs')
        .update({ progress: 50, gemini_file_uri: uploaded.uri, updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    if (hasImage) {
      const imgStr = body.imageBase64 as string;
      if (imgStr.length > MAX_IMAGE_BASE64_CHARS) throw new Error('INVALID_INPUT');
      const image = imgStr.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!image) throw new Error('INVALID_INPUT');
      const binary = atob(image[2]);
      const valid =
        image[1] === 'image/png'
          ? binary.startsWith('\x89PNG\r\n\x1a\n')
          : image[1] === 'image/jpeg'
            ? binary.startsWith('\xff\xd8\xff')
            : binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP';
      if (!valid) throw new Error('INVALID_INPUT');
      parts.push({ inlineData: { mimeType: image[1], data: image[2] } });
    }

    const generated = await callGemini(geminiKey, parts, requestId);
    model = generated.model;

    await db
      .from('ai_extraction_jobs')
      .update({
        status: 'completed',
        progress: 100,
        result_draft: generated.result,
        model_used: model,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    structuredLog('info', {
      requestId,
      uid: auth.uid,
      jobId,
      model,
      durationMs: Math.round(performance.now() - startedAt),
      status: 'ok',
    });

    return respond(
      req,
      { jobId, status: 'completed', result: generated.result },
      200,
      requestId,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    if (jobId) {
      await db
        .from('ai_extraction_jobs')
        .update({
          status: 'failed',
          error_code: code,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }
    structuredLog('error', {
      requestId,
      jobId,
      model,
      durationMs: Math.round(performance.now() - startedAt),
      status: 'error',
      code,
    });
    return failure(req, error, requestId);
  } finally {
    if (geminiKey && geminiUploadedName) {
      await deleteGeminiFileQuietly(geminiKey, geminiUploadedName);
    }
  }
}
