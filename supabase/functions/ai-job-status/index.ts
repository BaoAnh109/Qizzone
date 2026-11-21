import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
} from '../_shared/server.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return respond(req, { error: 'Method not allowed' }, 405);
  }
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    const db = databaseAdmin();
    const { activeRole } = await requireProfileAndRole(db, auth, ['teacher', 'admin']);

    let jobId: string | null = null;
    if (req.method === 'GET') {
      jobId = new URL(req.url).searchParams.get('id');
    } else {
      const body = (await bodyJson(req, 4096)) as { id?: unknown };
      jobId = typeof body.id === 'string' ? body.id : null;
    }

    if (!jobId || !UUID_REGEX.test(jobId)) {
      throw new Error('INVALID_INPUT');
    }

    const { data: job, error } = await db
      .from('ai_extraction_jobs')
      .select('id, owner_uid, status, progress, warnings, result_draft_id, result_draft, error_code')
      .eq('id', jobId)
      .maybeSingle();

    if (error) throw error;
    if (!job) throw new Error('NOT_FOUND');
    if (job.owner_uid !== auth.uid && activeRole !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    return respond(
      req,
      {
        id: job.id,
        status: job.status,
        progress: job.progress,
        warnings: job.warnings || [],
        resultDraftId: job.result_draft_id,
        resultDraft: job.result_draft,
        errorCode: job.error_code,
      },
      200,
      requestId,
    );
  } catch (error) {
    return failure(req, error, requestId);
  }
});
