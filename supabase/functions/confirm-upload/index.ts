import { headR2Object } from '../_shared/r2.ts';
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    const { activeRole } = await requireProfileAndRole(db, auth, ['teacher', 'admin']);

    const body = (await bodyJson(req, 4096)) as { materialId?: unknown };
    if (typeof body.materialId !== 'string' || !UUID_REGEX.test(body.materialId)) {
      throw new Error('INVALID_INPUT');
    }

    const { data: material, error: readError } = await db
      .from('materials')
      .select('*')
      .eq('id', body.materialId)
      .maybeSingle();

    if (readError) throw readError;
    if (!material) throw new Error('NOT_FOUND');
    if (material.owner_uid !== auth.uid && activeRole !== 'admin') {
      throw new Error('FORBIDDEN');
    }
    if (!String(material.object_key).startsWith(`materials/${material.owner_uid}/`)) {
      throw new Error('FORBIDDEN');
    }

    const head = await headR2Object(material.object_key);
    if (!head.exists) {
      throw new Error('R2_UPLOAD_NOT_FOUND');
    }
    if (head.contentLength <= 0 || head.contentLength > 50 * 1024 * 1024) {
      await db.from('materials').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', material.id);
      throw new Error('R2_SIZE_MISMATCH');
    }

    const now = new Date().toISOString();
    const { error: updateError } = await db
      .from('materials')
      .update({
        status: 'ready',
        size_bytes: head.contentLength,
        confirmed_at: now,
        updated_at: now,
      })
      .eq('id', material.id);
    if (updateError) throw updateError;

    structuredLog('info', {
      requestId,
      event: 'confirm_upload',
      uid: auth.uid,
      materialId: material.id,
      sizeBytes: head.contentLength,
    });

    return respond(
      req,
      { status: 'ready', sizeBytes: head.contentLength, mimeType: material.mime_type },
      200,
      requestId,
    );
  } catch (error) {
    structuredLog('error', {
      requestId,
      event: 'confirm_upload_error',
      code: error instanceof Error ? error.message : 'UNKNOWN',
    });
    return failure(req, error, requestId);
  }
});
