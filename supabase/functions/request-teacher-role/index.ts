import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  respond,
} from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const auth = await identity(req);
    await bodyJson(req, 4096);
    const db = databaseAdmin();

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('*')
      .eq('firebase_uid', auth.uid)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== 'student' || profile.approval_status !== 'approved') {
      throw new Error('FORBIDDEN');
    }
    if (profile.teacher_request_blocked) throw new Error('TEACHER_REQUEST_BLOCKED');
    if (profile.teacher_request_status === 'approved') {
      return respond(req, { ...profile, active_role: 'student' }, 200, requestId);
    }
    if (profile.teacher_request_status === 'pending') throw new Error('TEACHER_REQUEST_PENDING');

    const now = new Date().toISOString();
    const { data, error } = await db
      .from('profiles')
      .update({
        teacher_request_status: 'pending',
        teacher_requested_at: now,
        teacher_reviewed_at: null,
        teacher_reviewed_by: null,
        updated_at: now,
      })
      .eq('firebase_uid', auth.uid)
      .select()
      .single();
    if (error) throw error;

    await db.from('teacher_requests').upsert(
      {
        user_uid: auth.uid,
        status: 'pending',
        blocked: false,
        requested_at: now,
        reviewed_at: null,
        reviewed_by: null,
        updated_at: now,
      },
      { onConflict: 'user_uid' },
    );
    await db.from('role_audit_logs').insert({
      actor_uid: auth.uid,
      target_uid: auth.uid,
      action: 'request_teacher_role',
      previous_role: 'student',
      new_role: 'student',
    });

    return respond(req, { ...data, active_role: 'student' }, 200, requestId);
  } catch (error) {
    return failure(req, error, requestId);
  }
});
