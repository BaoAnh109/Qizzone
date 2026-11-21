import { presignR2ObjectUrl } from '../_shared/r2.ts';
import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
  structuredLog,
} from '../_shared/server.ts';

const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
]);

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'material').slice(0, 80);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    await requireProfileAndRole(db, auth, ['teacher', 'admin']);

    const body = (await bodyJson(req, 8192)) as {
      fileName?: unknown;
      mimeType?: unknown;
      sizeBytes?: unknown;
      sha256?: unknown;
    };

    if (
      typeof body.fileName !== 'string' ||
      !body.fileName.trim() ||
      typeof body.mimeType !== 'string' ||
      !ALLOWED_MIME_TYPES.has(body.mimeType) ||
      typeof body.sizeBytes !== 'number' ||
      !Number.isInteger(body.sizeBytes) ||
      body.sizeBytes <= 0 ||
      body.sizeBytes > MAX_SIZE_BYTES
    ) {
      throw new Error('INVALID_INPUT');
    }

    const sha256 =
      typeof body.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(body.sha256)
        ? body.sha256.toLowerCase()
        : null;

    const materialId = crypto.randomUUID();
    const safeName = sanitizeFileName(body.fileName);
    const objectKey = `materials/${auth.uid}/${materialId}-${safeName}`;

    const { url: putUrl, expiresAt } = await presignR2ObjectUrl({
      method: 'PUT',
      objectKey,
      expiresInSeconds: 300,
      contentType: body.mimeType,
    });

    const { error: insertError } = await db.from('materials').insert({
      id: materialId,
      owner_uid: auth.uid,
      object_key: objectKey,
      file_name: body.fileName.trim().slice(0, 255),
      mime_type: body.mimeType,
      size_bytes: body.sizeBytes,
      sha256,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    if (insertError) throw insertError;

    structuredLog('info', {
      requestId,
      event: 'create_upload_url',
      uid: auth.uid,
      materialId,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });

    return respond(req, { materialId, objectKey, putUrl, expiresAt }, 200, requestId);
  } catch (error) {
    structuredLog('error', {
      requestId,
      event: 'create_upload_url_error',
      code: error instanceof Error ? error.message : 'UNKNOWN',
    });
    return failure(req, error, requestId);
  }
});
