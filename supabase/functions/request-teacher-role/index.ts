import { bodyJson, cors, databaseAdmin, failure, firebaseAdmin, identity, respond } from '../_shared/server.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);

  try {
    const token = await identity(req);
    await bodyJson(req, 4096);
    const admin = firebaseAdmin();
    const user = await admin.getUser(token.uid);
    if (!user.email) throw new Error('INVALID_INPUT');
    const db = databaseAdmin();
    const { data: profile, error: profileError } = await db.from('profiles').select('*').eq('firebase_uid', token.uid).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== 'student' || profile.approval_status !== 'approved') throw new Error('FORBIDDEN');
    if (profile.teacher_request_blocked) throw new Error('TEACHER_REQUEST_BLOCKED');
    if (profile.teacher_request_status === 'approved') return respond(req, { ...profile, active_role: 'student' });
    if (profile.teacher_request_status === 'pending') throw new Error('TEACHER_REQUEST_PENDING');

    const now = new Date().toISOString();
    const { data, error } = await db.from('profiles').update({
      teacher_request_status: 'pending',
      teacher_requested_at: now,
      teacher_reviewed_at: null,
      teacher_reviewed_by: null,
      updated_at: now,
    }).eq('firebase_uid', token.uid).select().single();
    if (error) throw error;
    return respond(req, { ...data, active_role: 'student' });
  } catch (error) {
    return failure(req, error);
  }
});
