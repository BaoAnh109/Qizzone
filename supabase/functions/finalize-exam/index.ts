import { createClient } from 'npm:@supabase/supabase-js@2';
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
    await requireProfileAndRole(db, auth, ['student', 'teacher', 'admin']);

    const body = (await bodyJson(req, 4096)) as {
      attemptId?: unknown;
      idempotencyKey?: unknown;
    };
    if (
      typeof body.attemptId !== 'string' ||
      !UUID_REGEX.test(body.attemptId) ||
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey.trim().length < 8
    ) {
      throw new Error('INVALID_INPUT');
    }

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!anonKey || !supabaseUrl) throw new Error('NOT_CONFIGURED');

    // Call RPC under the student's JWT so auth.jwt()->>'sub' and RLS apply cleanly.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await userClient.rpc('finalize_exam_attempt', {
      p_attempt_id: body.attemptId,
      p_idempotency_key: body.idempotencyKey.trim().slice(0, 128),
    });

    if (error) {
      if (/quyền/i.test(error.message)) throw new Error('FORBIDDEN');
      throw error;
    }

    structuredLog('info', {
      requestId,
      event: 'finalize_exam',
      uid: auth.uid,
      attemptId: body.attemptId,
    });

    return respond(req, data, 200, requestId);
  } catch (error) {
    return failure(req, error, requestId);
  }
});
